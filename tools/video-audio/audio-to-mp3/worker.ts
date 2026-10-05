import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from "mediabunny";
import { createEncoder } from "wasm-media-encoders";
import {
  encoderSettings,
  type Job,
  type JobResult,
  MESSAGES,
  MP3_WASM_URL,
  mixDown,
  type Probe,
} from "./logic";

// The Web Worker of "Audio to MP3" (ADR 0061, ADR 0064). Mediabunny reads the recording in pieces and
// the browser's WebCodecs decoder turns its sound into samples; LAME encodes them to MP3. LAME is
// fetched from this site as its own unmodified WebAssembly file, never bundled into this worker,
// so it can be replaced. Nothing leaves the device.

async function probe(file: Blob): Promise<Probe> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) throw new ToolError(MESSAGES.notAudio);
    const audio = await input.getPrimaryAudioTrack();
    const durationSeconds = await input.computeDuration();
    const config = audio ? await audio.getDecoderConfig() : null;
    return {
      durationSeconds,
      audio: audio
        ? {
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

async function loadEncoder() {
  try {
    return await createEncoder("audio/mpeg", new URL(MP3_WASM_URL, self.location.origin).href);
  } catch {
    throw new ToolError(MESSAGES.encoderMissing);
  }
}

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  if (job.kind === "probe") return { kind: "probe", probe: await probe(job.file) };

  progress({ done: 0, total: 1000, stage: "Loading the MP3 encoder" });
  const encoder = await loadEncoder();
  const input = new Input({ source: new BlobSource(job.file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new ToolError(MESSAGES.noAudio);
    if (!(await track.canDecode())) throw new ToolError(MESSAGES.cannotDecode);
    const durationSeconds = await input.computeDuration();
    const settings = encoderSettings(track.sampleRate, track.numberOfChannels, job.bitrate);
    encoder.configure({
      channels: settings.channels,
      sampleRate: settings.sampleRate,
      outputSampleRate: settings.outputSampleRate,
      bitrate: settings.bitrate,
    });
    const chunks: Uint8Array[] = [];
    // The encoder owns the bytes it returns until its next call, so each piece is copied.
    const keep = (bytes: Uint8Array) => {
      if (bytes.length > 0) chunks.push(bytes.slice());
    };
    const sink = new AudioSampleSink(track);
    for await (const sample of sink.samples()) {
      try {
        signal.throwIfAborted();
        const planes: Float32Array[] = [];
        for (let plane = 0; plane < sample.numberOfChannels; plane++) {
          const options = { planeIndex: plane, format: "f32-planar" } as const;
          const data = new Float32Array(sample.allocationSize(options) / 4);
          sample.copyTo(data, options);
          planes.push(data);
        }
        keep(encoder.encode(mixDown(planes, settings.channels)));
        const done =
          durationSeconds > 0 ? (sample.timestamp + sample.duration) / durationSeconds : 0;
        progress({
          done: Math.min(999, Math.round(done * 1000)),
          total: 1000,
          stage: "Encoding the MP3",
        });
      } finally {
        sample.close();
      }
    }
    keep(encoder.finalize());
    if (chunks.length === 0) throw new ToolError(MESSAGES.failed);
    progress({ done: 1000, total: 1000, stage: "Done" });
    return {
      kind: "convert",
      blob: new Blob(chunks as BlobPart[], { type: "audio/mpeg" }),
      durationSeconds,
    };
  } catch (caught) {
    if (signal.aborted) throw caught;
    if (caught instanceof ToolError) throw caught;
    throw new ToolError(MESSAGES.failed);
  } finally {
    input.dispose();
  }
});
