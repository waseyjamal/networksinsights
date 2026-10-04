import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  WavOutputFormat,
} from "mediabunny";
import { type Job, type JobResult, MESSAGES, OUTPUTS, type Probe } from "./logic";

// The Web Worker of "Video to audio" (ADR 0051, ADR 0061). Mediabunny reads the video in pieces
// from the visitor's file, so only the sound is held in memory. M4A copies an AAC track as it is,
// with no codec involved; anything else goes through the browser's own WebCodecs decoder and
// encoder. Nothing leaves the device.

async function probe(file: Blob): Promise<Probe> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) throw new ToolError(MESSAGES.notVideo);
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    const durationSeconds = await input.computeDuration();
    const config = audio ? await audio.getDecoderConfig() : null;
    return {
      durationSeconds,
      hasVideo: video !== null,
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

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  if (job.kind === "probe") return { kind: "probe", probe: await probe(job.file) };

  progress({ done: 0, total: 1000, stage: "Reading the video" });
  const input = new Input({ source: new BlobSource(job.file), formats: ALL_FORMATS });
  const output = new Output({
    format: job.output === "m4a" ? new Mp4OutputFormat() : new WavOutputFormat(),
    target: new BufferTarget(),
  });
  try {
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      video: { discard: true },
      audio:
        job.output === "m4a"
          ? job.copy
            ? { codec: "aac" }
            : { codec: "aac", forceTranscode: true }
          : { codec: "pcm-s16" },
      // A copy keeps the AAC packets as they are; a transcode is made only when asked.
      copy: job.copy ? {} : false,
      showWarnings: false,
    });
    if (!conversion.isValid || conversion.utilizedTracks.length === 0)
      throw new ToolError(MESSAGES.noOutput);
    const stage = job.copy ? "Copying the sound" : "Converting the sound";
    conversion.onProgress = (fraction) =>
      progress({ done: Math.round(fraction * 1000), total: 1000, stage });
    const stop = () => void conversion.cancel();
    signal.addEventListener("abort", stop);
    signal.throwIfAborted();
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer) throw new ToolError(MESSAGES.failed);
    const durationSeconds = await input.computeDuration();
    progress({ done: 1000, total: 1000, stage: "Done" });
    return {
      kind: "convert",
      blob: new Blob([buffer], { type: OUTPUTS[job.output].mime }),
      copied: job.copy,
      durationSeconds,
    };
  } catch (caught) {
    if (caught instanceof ConversionCanceledError || signal.aborted) throw caught;
    if (caught instanceof ToolError) throw caught;
    throw new ToolError(MESSAGES.failed);
  } finally {
    input.dispose();
  }
});
