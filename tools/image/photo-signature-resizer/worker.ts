import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  findQuality,
  type Job,
  type JobResult,
  MESSAGES,
  placement,
  targetBytes,
  withinPixelLimit,
} from "./logic";

// The Web Worker of "Photo and Signature Resizer" (ADR 0051). The browser decodes the picture,
// an OffscreenCanvas draws it at the exact size on white, and convertToBlob writes JPG files at
// the qualities findQuality() asks for until one is the largest that fits the KB limit.

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(job.file);
  } catch {
    throw new ToolError(MESSAGES.unreadable);
  }
  try {
    if (!withinPixelLimit(bitmap.width, bitmap.height)) throw new ToolError(MESSAGES.tooManyPixels);
    const canvas = new OffscreenCanvas(job.width, job.height);
    const context = canvas.getContext("2d");
    if (!context) throw new ToolError(MESSAGES.failed);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, job.width, job.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const at = placement(bitmap, job, job.fit);
    context.drawImage(bitmap, at.sx, at.sy, at.sw, at.sh, at.dx, at.dy, at.dw, at.dh);

    const found = await findQuality(
      async (quality) => {
        signal.throwIfAborted();
        return canvas.convertToBlob({ type: "image/jpeg", quality });
      },
      targetBytes(job.maxKb),
      (done, total) => progress({ done, total, stage: "Finding the size" }),
    );
    if (!found.met) return { met: false, smallestBytes: found.smallest.size };
    return { met: true, blob: found.file, quality: found.quality };
  } finally {
    bitmap.close();
  }
});
