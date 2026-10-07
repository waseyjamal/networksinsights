import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { ALL_FORMATS, type AudioSample, AudioSampleSink, BlobSource, Input } from "mediabunny";
import {
  type ClipInfo,
  checkClip,
  type Job,
  type JobResult,
  MESSAGES,
  matchChannels,
  resample,
  toPcm16,
  wavHeader,
} from "./logic";

// The Web Worker of "Audio Joiner" (ADR 0051, ADR 0061). Mediabunny reads each recording from the
// visitor's file and decodes it: WAV needs no codec, other formats use the browser's WebCodecs,
// asked first with canDecode. A probe decodes the first piece of sound, so the sample rate and
// channels it reports are the ones the decoder really gives. Joining decodes one clip at a time,
// matches it to the joined file's rate and channels in logic.ts, and keeps it as 16-bit samples;
// the WAV header is written last, when the length is known.

/** Every decoded sample of the clip, one Float32Array per channel. */
async function decode(
  file: Blob,
  signal: { throwIfAborted(): void },
): Promise<{ planes: Float32Array[]; sampleRate: number }> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new ToolError(MESSAGES.noAudio);
    if (!(await track.canDecode()))
      throw new ToolError(MESSAGES.cannotDecode(track.codec ?? "this"));
    const chunks: Float32Array[][] = [];
    let channels = 0;
    let sampleRate = 0;
    let frames = 0;
    for await (const sample of new AudioSampleSink(track).samples()) {
      try {
        signal.throwIfAborted();
        if (channels === 0) {
          channels = sample.numberOfChannels;
          sampleRate = sample.sampleRate;
        }
        if (sample.numberOfChannels !== channels || sample.sampleRate !== sampleRate) {
          throw new ToolError(MESSAGES.failed);
        }
        chunks.push(planesOf(sample));
        frames += sample.numberOfFrames;
      } finally {
        sample.close();
      }
    }
    if (channels === 0) throw new ToolError(MESSAGES.noAudio);
    const problem = checkClip({ channels, sampleRate, durationSeconds: 0, codec: null });
    if (problem) throw new ToolError(problem);
    const planes = Array.from({ length: channels }, () => new Float32Array(frames));
    let at = 0;
    for (const chunk of chunks) {
      for (const [channel, plane] of planes.entries()) plane.set(chunk[channel] ?? [], at);
      at += chunk[0]?.length ?? 0;
    }
    return { planes, sampleRate };
  } finally {
    input.dispose();
  }
}

function planesOf(sample: AudioSample): Float32Array[] {
  return Array.from({ length: sample.numberOfChannels }, (_, planeIndex) => {
    const plane = new Float32Array(sample.numberOfFrames);
    sample.copyTo(plane, { planeIndex, format: "f32-planar" });
    return plane;
  });
}

async function probe(file: Blob): Promise<ClipInfo> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) throw new ToolError(MESSAGES.notAudio);
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new ToolError(MESSAGES.noAudio);
    if (!(await track.canDecode()))
      throw new ToolError(MESSAGES.cannotDecode(track.codec ?? "this"));
    let sampleRate = track.sampleRate;
    let channels = track.numberOfChannels;
    for await (const sample of new AudioSampleSink(track).samples()) {
      sampleRate = sample.sampleRate;
      channels = sample.numberOfChannels;
      sample.close();
      break;
    }
    const clip = {
      durationSeconds: await input.computeDuration(),
      sampleRate,
      channels,
      codec: track.codec,
    };
    const problem = checkClip(clip);
    if (problem) throw new ToolError(problem);
    return clip;
  } catch (caught) {
    if (caught instanceof ToolError) throw caught;
    throw new ToolError(MESSAGES.unreadable);
  } finally {
    input.dispose();
  }
}

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  if (job.kind === "probe") return { kind: "probe", clip: await probe(job.file) };
  if (job.files.length < 2) throw new ToolError(MESSAGES.needTwo);
  const parts: Uint8Array[] = [];
  let dataBytes = 0;
  try {
    for (const [index, file] of job.files.entries()) {
      progress({ done: index, total: job.files.length, stage: `Decoding recording ${index + 1}` });
      const clip = await decode(file, signal);
      if (clip.sampleRate > job.sampleRate || clip.planes.length > job.channels) {
        // The page chose the format from the probes; a clip never has to be made smaller.
        throw new ToolError(MESSAGES.failed);
      }
      const matched = matchChannels(
        clip.planes.map((plane) => resample(plane, clip.sampleRate, job.sampleRate)),
        job.channels,
      );
      const pcm = toPcm16(matched);
      parts.push(pcm);
      dataBytes += pcm.length;
    }
  } catch (caught) {
    if (signal.aborted) throw caught;
    if (caught instanceof ToolError) throw caught;
    throw new ToolError(MESSAGES.failed);
  }
  progress({ done: job.files.length, total: job.files.length, stage: "Done" });
  const header = wavHeader(dataBytes, job.sampleRate, job.channels);
  return {
    kind: "join",
    blob: new Blob([header as BlobPart, ...(parts as BlobPart[])], { type: "audio/wav" }),
    durationMs: Math.round((dataBytes / (job.channels * 2) / job.sampleRate) * 1000),
    sampleRate: job.sampleRate,
    channels: job.channels,
  };
});
