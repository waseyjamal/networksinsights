import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { applyPalette, GIFEncoder, quantize } from "gifenc/dist/gifenc.esm.js";
import {
  fit,
  type Job,
  type JobResult,
  MESSAGES,
  PALETTE_SAMPLE_PIXELS,
  paletteSample,
  repeatFor,
} from "./logic";

// The Web Worker of "Images to GIF" (ADR 0051, ADR 0061). The browser decodes each picture (and
// turns it upright); an OffscreenCanvas draws it in the middle of a white frame of the GIF's size,
// as large as fits. gifenc picks 256 colours for each frame, from an even sample of its pixels,
// and writes the GIF. Nothing leaves the device.

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  if (typeof OffscreenCanvas === "undefined") throw new ToolError(MESSAGES.noCanvas);
  const total = job.images.length;
  const canvas = new OffscreenCanvas(job.width, job.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new ToolError(MESSAGES.noCanvas);
  const gif = GIFEncoder();
  for (const [index, image] of job.images.entries()) {
    signal.throwIfAborted();
    progress({ done: index, total, stage: `Picture ${index + 1}` });
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(image);
    } catch {
      throw new ToolError(MESSAGES.unreadable(`Picture ${index + 1}`));
    }
    try {
      // GIF has no partial transparency: every frame starts on white.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, job.width, job.height);
      const place = fit(bitmap.width, bitmap.height, job.width, job.height);
      context.drawImage(bitmap, place.x, place.y, place.width, place.height);
    } finally {
      bitmap.close();
    }
    const { data } = context.getImageData(0, 0, job.width, job.height);
    const palette = quantize(paletteSample(data, PALETTE_SAMPLE_PIXELS), 256);
    gif.writeFrame(applyPalette(data, palette), job.width, job.height, {
      palette,
      delay: job.delay,
      repeat: repeatFor(job.loop),
    });
  }
  gif.finish();
  progress({ done: total, total, stage: "Done" });
  return { blob: new Blob([gif.bytes() as BlobPart], { type: "image/gif" }), frames: total };
});
