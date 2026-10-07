import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  ALL_FORMATS,
  BlobSource,
  BufferSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  MkvOutputFormat,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from "mediabunny";
import {
  CONTAINERS,
  type Container,
  containerFor,
  type Job,
  type JobResult,
  MESSAGES,
  type Probe,
} from "./logic";

// The Web Worker of "Mute Video" (ADR 0051, ADR 0061). Mediabunny reads the video in pieces from
// the visitor's file and copies the encoded video packets as they are into a new file of the same
// kind, with every audio track left out. Copying is forced: if the video track could not be
// copied, the conversion would drop it, and the worker then refuses instead of re-encoding. No
// codec is used, so it works in browsers without WebCodecs.

const formatFor = (container: Container) => {
  if (container === "webm") return new WebMOutputFormat();
  if (container === "mkv") return new MkvOutputFormat();
  if (container === "mov") return new MovOutputFormat();
  return new Mp4OutputFormat();
};

async function probe(file: Blob): Promise<Probe> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) throw new ToolError(MESSAGES.notVideo);
    const format = await input.getFormat();
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new ToolError(MESSAGES.noVideo);
    const audioTracks = (await input.getAudioTracks()).length;
    return {
      container: containerFor(format.name),
      durationSeconds: await input.computeDuration(),
      videoCodec: video.codec,
      width: video.displayWidth,
      height: video.displayHeight,
      hasAudio: audioTracks > 0,
      audioTracks,
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
    const container = containerFor((await input.getFormat()).name);
    if ((await input.getAudioTracks()).length === 0) throw new ToolError(MESSAGES.noAudio);
    const output = new Output({ format: formatFor(container), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      audio: { discard: true },
      copy: { mode: "forced" },
      showWarnings: false,
    });
    const keepsVideo = conversion.utilizedTracks.some((track) => track.isVideoTrack());
    const keepsAudio = conversion.utilizedTracks.some((track) => track.isAudioTrack());
    if (!conversion.isValid || !keepsVideo || keepsAudio) throw new ToolError(MESSAGES.cannotCopy);
    conversion.onProgress = (fraction) =>
      progress({ done: Math.round(fraction * 1000), total: 1000, stage: "Copying the video" });
    const stop = () => void conversion.cancel();
    signal.addEventListener("abort", stop);
    signal.throwIfAborted();
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer) throw new ToolError(MESSAGES.failed);
    const written = new Input({ source: new BufferSource(buffer), formats: ALL_FORMATS });
    let duration: number;
    try {
      if ((await written.getAudioTracks()).length > 0) throw new ToolError(MESSAGES.failed);
      duration = await written.computeDuration();
    } finally {
      written.dispose();
    }
    progress({ done: 1000, total: 1000, stage: "Done" });
    return {
      kind: "mute",
      blob: new Blob([buffer], { type: CONTAINERS[container].mime }),
      durationMs: Math.round(duration * 1000),
      container,
    };
  } catch (caught) {
    if (caught instanceof ConversionCanceledError || signal.aborted) throw caught;
    if (caught instanceof ToolError) throw caught;
    throw new ToolError(MESSAGES.failed);
  } finally {
    input.dispose();
  }
});
