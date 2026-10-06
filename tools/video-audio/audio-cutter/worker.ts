import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  ALL_FORMATS,
  BlobSource,
  BufferSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  WavOutputFormat,
} from "mediabunny";
import { type Job, type JobResult, MESSAGES, type Mode, type Probe } from "./logic";

// The Web Worker of "Audio Cutter" (ADR 0051, ADR 0061). Mediabunny reads the recording in pieces
// from the visitor's file. Copy keeps the encoded sound as it is, in an M4A file, so it needs no
// codec; Mediabunny says per file whether it can do that. WAV decodes the sound with the browser's
// WebCodecs (raw PCM needs no decoder) and writes 16-bit samples; Mediabunny's Conversion reads the
// decoded samples from time 0, not from before it, which once stalled AAC in WebKit. The new file
// is built in memory and read back to report its real length.

const fresh = (file: Blob) => new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

/** A conversion of the sound only, from `start` to `end` seconds, copied or as WAV. */
function convert(input: Input, mode: Mode, start: number, end: number) {
  const output = new Output({
    format: mode === "copy" ? new Mp4OutputFormat() : new WavOutputFormat(),
    target: new BufferTarget(),
  });
  const conversion = Conversion.init({
    input,
    output,
    tracks: "primary",
    trim: { start, end },
    video: { discard: true },
    audio: mode === "wav" ? { codec: "pcm-s16", forceTranscode: true } : {},
    copy: mode === "copy" ? { mode: "forced" } : {},
    showWarnings: false,
  });
  return { output, conversion };
}

async function probe(file: Blob): Promise<Probe> {
  const input = fresh(file);
  try {
    if (!(await input.canRead())) throw new ToolError(MESSAGES.notAudio);
    const format = await input.getFormat();
    const audio = await input.getPrimaryAudioTrack();
    if (!audio) throw new ToolError(MESSAGES.noAudio);
    const durationSeconds = await input.computeDuration();
    const config = await audio.getDecoderConfig();
    let copyable = false;
    if (/mp4|quicktime/i.test(format.name) && durationSeconds > 0) {
      // Mediabunny decides here, without writing anything, whether a copied cut is possible.
      const { conversion } = convert(input, "copy", 0, durationSeconds);
      const ready = await conversion;
      copyable = ready.isValid && ready.utilizedTracks.some((track) => track.isAudioTrack());
    }
    return {
      durationSeconds,
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
      copyable,
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

  progress({ done: 0, total: 1000, stage: "Reading the recording" });
  const input = fresh(job.file);
  try {
    const made = convert(input, job.mode, job.startMs / 1000, job.endMs / 1000);
    const conversion = await made.conversion;
    const keepsAudio = conversion.utilizedTracks.some((track) => track.isAudioTrack());
    if (!conversion.isValid || !keepsAudio) throw new ToolError(MESSAGES.failed);
    const stage = job.mode === "copy" ? "Copying the sound" : "Writing the WAV";
    conversion.onProgress = (fraction) =>
      progress({ done: Math.round(fraction * 1000), total: 1000, stage });
    const stop = () => void conversion.cancel();
    signal.addEventListener("abort", stop);
    signal.throwIfAborted();
    await conversion.execute();
    const buffer = made.output.target.buffer;
    if (!buffer) throw new ToolError(MESSAGES.failed);
    const written = new Input({ source: new BufferSource(buffer), formats: ALL_FORMATS });
    let duration: number;
    try {
      duration = await written.computeDuration();
    } finally {
      written.dispose();
    }
    progress({ done: 1000, total: 1000, stage: "Done" });
    return {
      kind: "cut",
      blob: new Blob([buffer], { type: job.mode === "copy" ? "audio/mp4" : "audio/wav" }),
      durationMs: Math.round(duration * 1000),
    };
  } catch (caught) {
    if (caught instanceof ConversionCanceledError || signal.aborted) throw caught;
    if (caught instanceof ToolError) throw caught;
    throw new ToolError(MESSAGES.failed);
  } finally {
    input.dispose();
  }
});
