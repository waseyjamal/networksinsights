import { registerFlacEncoder } from "@mediabunny/flac-encoder";
import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  ALL_FORMATS,
  type AudioCodec,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  FlacOutputFormat,
  Input,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  type OutputFormat,
  WavOutputFormat,
} from "mediabunny";
import { type Job, type JobResult, MESSAGES, OUTPUTS, type OutputKind, type Probe } from "./logic";

// The Web Worker of "Audio converter" (ADR 0051, ADR 0061). Mediabunny reads the file in pieces
// and writes the new one in memory. Opus and AAC are encoded by the browser's own WebCodecs
// encoders; FLAC by libFLAC compiled to WebAssembly (@mediabunny/flac-encoder), which runs in a
// worker of its own. Nothing leaves the device.

let flacReady = false;

const FORMATS: Record<OutputKind, () => OutputFormat> = {
  wav: () => new WavOutputFormat(),
  flac: () => new FlacOutputFormat(),
  ogg: () => new OggOutputFormat(),
  m4a: () => new Mp4OutputFormat(),
};

const CODECS: Record<OutputKind, AudioCodec> = {
  wav: "pcm-s16",
  flac: "flac",
  ogg: "opus",
  m4a: "aac",
};

async function probe(file: Blob): Promise<Probe> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
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

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  if (job.kind === "probe") return { kind: "probe", probe: await probe(job.file) };

  if (job.output === "flac" && !flacReady) {
    registerFlacEncoder();
    flacReady = true;
  }
  progress({ done: 0, total: 1000, stage: "Reading the file" });
  const input = new Input({ source: new BlobSource(job.file), formats: ALL_FORMATS });
  const output = new Output({ format: FORMATS[job.output](), target: new BufferTarget() });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new ToolError(MESSAGES.noAudio);
    const codec = CODECS[job.output];
    const copied = track.codec === codec;
    const lossy = job.output === "ogg" || job.output === "m4a";
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      video: { discard: true },
      audio: {
        codec,
        // Opus works at 48 kHz only; AAC encoders take 44.1 or 48 kHz.
        ...(job.output === "ogg" && !copied ? { sampleRate: 48_000 } : {}),
        ...(job.output === "m4a" && !copied && ![44_100, 48_000].includes(track.sampleRate)
          ? { sampleRate: 48_000 }
          : {}),
        ...(lossy && !copied ? { bitrate: job.bitrate } : {}),
        ...(track.numberOfChannels > 2 ? { numberOfChannels: 2 } : {}),
      },
      showWarnings: false,
    });
    if (!conversion.isValid || conversion.utilizedTracks.length === 0)
      throw new ToolError(MESSAGES.failed);
    const stage = copied ? "Copying the sound" : `Encoding ${OUTPUTS[job.output].label}`;
    conversion.onProgress = (fraction) =>
      progress({ done: Math.round(fraction * 1000), total: 1000, stage });
    signal.addEventListener("abort", () => void conversion.cancel());
    signal.throwIfAborted();
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer) throw new ToolError(MESSAGES.failed);
    progress({ done: 1000, total: 1000, stage: "Done" });
    return {
      kind: "convert",
      blob: new Blob([buffer], { type: OUTPUTS[job.output].mime }),
      copied,
    };
  } catch (caught) {
    if (caught instanceof ConversionCanceledError || signal.aborted) throw caught;
    if (caught instanceof ToolError) throw caught;
    throw new ToolError(MESSAGES.failed);
  } finally {
    input.dispose();
  }
});
