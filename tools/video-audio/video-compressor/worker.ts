import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  type ConversionAudioOptions,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  WebMOutputFormat,
} from "mediabunny";
import {
  AUDIO_BITRATE,
  CONTAINERS,
  type ConvertJob,
  type DecoderConfigLike,
  type Job,
  type JobResult,
  MESSAGES,
  type Probe,
} from "./logic";

// The Web Worker of "Video compressor" (ADR 0051, ADR 0061). Mediabunny reads the video in pieces,
// the browser's WebCodecs decoder and encoder make the picture again at the chosen size and
// quality, and the new file is built in memory. The sound is copied when the container takes it.
// Nothing leaves the device.

const PRESETS = { high: QUALITY_HIGH, medium: QUALITY_MEDIUM, low: QUALITY_LOW } as const;

/** A decoder config as plain data that survives postMessage: no VideoColorSpace objects. */
function plain(config: { codec: string; description?: unknown } | null): DecoderConfigLike | null {
  if (!config) return null;
  return {
    codec: config.codec,
    ...(config.description ? { description: config.description } : {}),
  };
}

async function probe(file: Blob): Promise<Probe> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) throw new ToolError(MESSAGES.notVideo);
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    const audioConfig = audio ? await audio.getDecoderConfig() : null;
    return {
      durationSeconds: await input.computeDuration(),
      video: video
        ? {
            codec: video.codec,
            width: video.displayWidth,
            height: video.displayHeight,
            decoderConfig: plain(await video.getDecoderConfig()),
          }
        : null,
      audio: audio
        ? {
            codec: audio.codec,
            sampleRate: audio.sampleRate,
            channels: audio.numberOfChannels,
            decoderConfig: audioConfig
              ? {
                  codec: audioConfig.codec,
                  sampleRate: audioConfig.sampleRate,
                  numberOfChannels: audioConfig.numberOfChannels,
                  ...(audioConfig.description ? { description: audioConfig.description } : {}),
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

function audioOptions(job: ConvertJob): ConversionAudioOptions {
  const codec = CONTAINERS[job.container].audio;
  if (job.audio === "drop" || job.audio === "none") return { discard: true };
  if (job.audio === "copy") return {};
  return {
    codec,
    bitrate: AUDIO_BITRATE,
    forceTranscode: true,
    ...(codec === "opus" ? { sampleRate: 48_000 } : {}),
  };
}

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  if (job.kind === "probe") return { kind: "probe", probe: await probe(job.file) };

  progress({ done: 0, total: 1000, stage: "Reading the video" });
  const container = CONTAINERS[job.container];
  const input = new Input({ source: new BlobSource(job.file), formats: ALL_FORMATS });
  const output = new Output({
    format:
      job.container === "mp4"
        ? new Mp4OutputFormat({ fastStart: "in-memory" })
        : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  try {
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      video: {
        codec: container.video,
        width: job.width,
        height: job.height,
        fit: "contain",
        bitrate: typeof job.quality === "number" ? job.quality : PRESETS[job.quality],
        forceTranscode: true,
      },
      audio: audioOptions(job),
      showWarnings: false,
    });
    const keptVideo = conversion.utilizedTracks.some((track) => track.type === "video");
    if (!conversion.isValid || !keptVideo) throw new ToolError(MESSAGES.noOutput);
    const audioKept = conversion.utilizedTracks.some((track) => track.type === "audio");
    conversion.onProgress = (fraction) =>
      progress({ done: Math.round(fraction * 1000), total: 1000, stage: "Compressing" });
    signal.addEventListener("abort", () => void conversion.cancel());
    signal.throwIfAborted();
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer) throw new ToolError(MESSAGES.failed);
    progress({ done: 1000, total: 1000, stage: "Done" });
    return {
      kind: "convert",
      blob: new Blob([buffer], { type: container.mime }),
      width: job.width,
      height: job.height,
      audioKept,
    };
  } catch (caught) {
    if (caught instanceof ConversionCanceledError || signal.aborted) throw caught;
    if (caught instanceof ToolError) throw caught;
    throw new ToolError(MESSAGES.failed);
  } finally {
    input.dispose();
  }
});
