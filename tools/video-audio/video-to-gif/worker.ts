import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { applyPalette, GIFEncoder, quantize } from "gifenc/dist/gifenc.esm.js";
import { ALL_FORMATS, BlobSource, Input, type VideoSample, VideoSampleSink } from "mediabunny";
import {
  type Job,
  type JobResult,
  MESSAGES,
  PALETTE_SAMPLE_PIXELS,
  type Probe,
  paletteSample,
} from "./logic";

// The Web Worker of "Video to GIF" (ADR 0051, ADR 0061). Mediabunny reads the video in pieces and
// the browser's WebCodecs decoder gives the frames in order; the ones at the chosen times are drawn
// at the GIF's size on an OffscreenCanvas. gifenc picks 256 colours for each frame and writes the
// GIF. Nothing leaves
// the device.

async function probe(file: Blob): Promise<Probe> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) throw new ToolError(MESSAGES.notVideo);
    const video = await input.getPrimaryVideoTrack();
    const config = video ? await video.getDecoderConfig() : null;
    return {
      durationSeconds: await input.computeDuration(),
      startSeconds: video ? await video.getFirstTimestamp() : 0,
      video: video
        ? {
            codec: video.codec,
            width: video.displayWidth,
            height: video.displayHeight,
            decoderConfig: config
              ? {
                  codec: config.codec,
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

  const total = job.times.length;
  progress({ done: 0, total, stage: "Reading the video" });
  const input = new Input({ source: new BlobSource(job.file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new ToolError(MESSAGES.noVideo);
    // The frames are decoded once, in order, and only those the GIF needs are drawn: asking for a
    // frame at each time would decode the same stretch of video again and again.
    const sink = new VideoSampleSink(track);
    const canvas = new OffscreenCanvas(job.width, job.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new ToolError(MESSAGES.failed);
    const gif = GIFEncoder();
    let frames = 0;
    const add = (sample: VideoSample) => {
      sample.drawWithFit(context, { fit: "fill", rotation: sample.rotation, flip: sample.flip });
      const { data } = context.getImageData(0, 0, job.width, job.height);
      // The palette is chosen from an even sample of the pixels, then every pixel is mapped to it:
      // choosing it from all of them took most of the time and changes little.
      const palette = quantize(paletteSample(data, PALETTE_SAMPLE_PIXELS), 256);
      gif.writeFrame(applyPalette(data, palette), job.width, job.height, {
        palette,
        delay: job.delay,
      });
      frames++;
      progress({ done: frames, total, stage: "Making frames" });
    };
    const first = job.times[0] ?? 0;
    const last = job.times[total - 1] ?? first;
    let previous: VideoSample | null = null;
    try {
      for await (const sample of sink.samples(first, last + 0.001)) {
        signal.throwIfAborted();
        // Each wanted time before this frame shows the frame before it.
        if (previous) {
          while (frames < total && (job.times[frames] ?? 0) < sample.timestamp) add(previous);
          previous.close();
        }
        previous = sample;
        if (frames >= total) break;
      }
      // The times after the last decoded frame show that frame.
      while (previous && frames < total) {
        signal.throwIfAborted();
        add(previous);
      }
    } finally {
      previous?.close();
    }
    if (frames === 0) throw new ToolError(MESSAGES.noFrames);
    gif.finish();
    const bytes = gif.bytes();
    progress({ done: total, total, stage: "Done" });
    return { kind: "convert", blob: new Blob([bytes as BlobPart], { type: "image/gif" }), frames };
  } catch (caught) {
    if (signal.aborted) throw caught;
    if (caught instanceof ToolError) throw caught;
    throw new ToolError(MESSAGES.failed);
  } finally {
    input.dispose();
  }
});
