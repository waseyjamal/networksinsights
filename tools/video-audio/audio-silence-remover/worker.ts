import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
} from "mediabunny";
import {
  applyGain,
  checkLength,
  checkSettings,
  type Job,
  type JobResult,
  joinSpans,
  keptSpans,
  MESSAGES,
  OUTPUTS,
  type OutputId,
  type Probe,
  peakGainDb,
  wavBytes,
} from "./logic";

// The Web Worker of "Audio Silence Remover" (ADR 0051, ADR 0061). Mediabunny reads the recording and
// the browser's WebCodecs decoder turns it into samples (raw PCM needs none), read from time 0, not
// from before it, which once stalled AAC in WebKit. The whole recording is held as samples; logic.ts
// finds the silence, keeps the rest and normalises the peak. WAV is written here; M4A (AAC) and OGG
// (Opus) are encoded by WebCodecs, offered only where the page found the browser can.

const fresh = (file: Blob) => new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

async function probe(file: Blob): Promise<Probe> {
  const input = fresh(file);
  try {
    if (!(await input.canRead())) throw new ToolError(MESSAGES.notAudio);
    const audio = await input.getPrimaryAudioTrack();
    if (!audio) throw new ToolError(MESSAGES.noAudio);
    const config = await audio.getDecoderConfig();
    return {
      durationSeconds: await input.computeDuration(),
      codec: audio.codec,
      sampleRate: audio.sampleRate,
      channels: audio.numberOfChannels,
      decoderConfig: config
        ? {
            codec: config.codec,
            sampleRate: config.sampleRate,
            numberOfChannels: config.numberOfChannels,
            ...(config.description ? { description: config.description } : {}),
          }
        : null,
    };
  } catch (caught) {
    if (caught instanceof ToolError) throw caught;
    throw new ToolError(MESSAGES.unreadable);
  } finally {
    input.dispose();
  }
}

/** Every sample of the first two channels, one Float32Array a channel. */
async function decode(file: Blob, signal: { throwIfAborted(): void }) {
  const input = fresh(file);
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new ToolError(MESSAGES.noAudio);
    const problem = checkLength(await input.computeDuration());
    if (problem) throw new ToolError(problem);
    const channels = Math.min(2, track.numberOfChannels);
    const pieces: Float32Array[][] = Array.from({ length: channels }, () => []);
    let frames = 0;
    for await (const sample of new AudioSampleSink(track).samples(0)) {
      try {
        signal.throwIfAborted();
        for (let plane = 0; plane < channels; plane++) {
          const options = { planeIndex: plane, format: "f32-planar" } as const;
          const data = new Float32Array(sample.allocationSize(options) / 4);
          sample.copyTo(data, options);
          pieces[plane]?.push(data);
          if (plane === 0) frames += data.length;
        }
      } finally {
        sample.close();
      }
    }
    const planes = pieces.map((list) => {
      const out = new Float32Array(frames);
      let at = 0;
      for (const piece of list) {
        out.set(piece.subarray(0, frames - at), at);
        at += piece.length;
      }
      return out;
    });
    return { planes, sampleRate: track.sampleRate };
  } finally {
    input.dispose();
  }
}

async function encode(planes: Float32Array[], sampleRate: number, output: OutputId) {
  if (output === "wav") return wavBytes(planes, sampleRate);
  const target = new Output({
    format: output === "m4a" ? new Mp4OutputFormat() : new OggOutputFormat(),
    target: new BufferTarget(),
  });
  const source = new AudioSampleSource({
    codec: output === "m4a" ? "aac" : "opus",
    bitrate: 128_000,
    ...(output === "ogg" && sampleRate !== 48_000 ? { transform: { sampleRate: 48_000 } } : {}),
  });
  target.addAudioTrack(source);
  await target.start();
  const frames = planes[0]?.length ?? 0;
  const step = sampleRate; // one second at a time
  for (let start = 0; start < frames; start += step) {
    const end = Math.min(frames, start + step);
    const data = new Float32Array((end - start) * planes.length);
    for (const [index, plane] of planes.entries()) {
      data.set(plane.subarray(start, end), index * (end - start));
    }
    const sample = new AudioSample({
      data,
      format: "f32-planar",
      numberOfChannels: planes.length,
      sampleRate,
      timestamp: start / sampleRate,
    });
    await source.add(sample);
    sample.close();
  }
  source.close();
  await target.finalize();
  const buffer = target.target.buffer;
  if (!buffer) throw new ToolError(MESSAGES.failed);
  return new Uint8Array(buffer);
}

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  if (job.kind === "probe") return { kind: "probe", probe: await probe(job.file) };

  const problems = Object.values(checkSettings(job.threshold, job.minSilence));
  if (problems[0]) throw new ToolError(problems[0]);
  progress({ done: 0, total: 3, stage: "Decoding" });
  let decoded: Awaited<ReturnType<typeof decode>>;
  try {
    decoded = await decode(job.file, signal);
  } catch (caught) {
    if (caught instanceof ToolError || signal.aborted) throw caught;
    throw new ToolError(MESSAGES.cannotDecode);
  }
  const { planes, sampleRate } = decoded;
  progress({ done: 1, total: 3, stage: "Finding silence" });
  const spans = keptSpans(planes, sampleRate, job.threshold, job.minSilence);
  if (spans.length === 0) throw new ToolError(MESSAGES.allSilent);
  const kept = joinSpans(planes, spans);
  const gainDb = job.normalize ? peakGainDb(kept) : 0;
  if (gainDb !== 0) applyGain(kept, gainDb);
  progress({ done: 2, total: 3, stage: "Writing" });
  let bytes: Uint8Array;
  try {
    bytes = await encode(kept, sampleRate, job.output);
  } catch (caught) {
    if (caught instanceof ToolError) throw caught;
    throw new ToolError(MESSAGES.failed);
  }
  progress({ done: 3, total: 3 });
  return {
    kind: "clean",
    blob: new Blob([bytes as BlobPart], { type: OUTPUTS[job.output].mime }),
    beforeSeconds: (planes[0]?.length ?? 0) / sampleRate,
    afterSeconds: (kept[0]?.length ?? 0) / sampleRate,
    gainDb,
  };
});
