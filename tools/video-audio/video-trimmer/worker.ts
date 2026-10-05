import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  ALL_FORMATS,
  BlobSource,
  BufferSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  type VideoCodec,
  WebMOutputFormat,
} from "mediabunny";
import { containerFor, type Job, type JobResult, MESSAGES, type Probe } from "./logic";

// The Web Worker of "Video Trimmer" (ADR 0051, ADR 0061). Mediabunny reads the video in pieces from
// the visitor's file. Fast copies the encoded video and sound as they are: the cut starts at the
// last key frame at or before the chosen start, found here, so no codec is needed. Exact decodes
// and encodes the video again with the browser's WebCodecs, so the cut starts on the chosen frame;
// the sound is copied. The new file is built in memory and read back to report its real length.

async function probe(file: Blob): Promise<Probe> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) throw new ToolError(MESSAGES.notVideo);
    const format = await input.getFormat();
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new ToolError(MESSAGES.noVideo);
    const config = await video.getDecoderConfig();
    return {
      durationSeconds: await input.computeDuration(),
      container: containerFor(format.name),
      video: {
        codec: video.codec,
        width: video.displayWidth,
        height: video.displayHeight,
        decoderConfig: config
          ? {
              codec: config.codec,
              ...(config.description ? { description: config.description } : {}),
            }
          : null,
      },
      hasAudio: (await input.getPrimaryAudioTrack()) !== null,
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
  try {
    const format = await input.getFormat();
    const container = containerFor(format.name);
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new ToolError(MESSAGES.noVideo);
    let start = job.startMs / 1000;
    if (job.mode === "fast") {
      // The last key frame at or before the start: a copied cut can only begin there.
      const key = await new EncodedPacketSink(video).getKeyPacket(start, { metadataOnly: true });
      start = key ? Math.max(0, key.timestamp) : 0;
    }
    const output = new Output({
      format: container === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat(),
      target: new BufferTarget(),
    });
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      trim: { start, end: job.endMs / 1000 },
      video:
        job.mode === "exact"
          ? { forceTranscode: true, ...(job.codec ? { codec: job.codec as VideoCodec } : {}) }
          : {},
      copy: job.mode === "fast" ? { mode: "forced" } : {},
      showWarnings: false,
    });
    const keepsVideo = conversion.utilizedTracks.some((track) => track.isVideoTrack());
    if (!conversion.isValid || !keepsVideo) {
      throw new ToolError(job.mode === "fast" ? MESSAGES.cannotCopy : MESSAGES.failed);
    }
    const stage = job.mode === "fast" ? "Copying the video" : "Encoding the video";
    conversion.onProgress = (fraction) =>
      progress({ done: Math.round(fraction * 1000), total: 1000, stage });
    const stop = () => void conversion.cancel();
    signal.addEventListener("abort", stop);
    signal.throwIfAborted();
    await conversion.execute();
    const buffer = output.target.buffer;
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
      kind: "trim",
      blob: new Blob([buffer], {
        type: container === "webm" ? "video/webm" : "video/mp4",
      }),
      startMs: Math.round(start * 1000),
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
