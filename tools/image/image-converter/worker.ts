import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  type Job,
  type JobResult,
  MESSAGES,
  needsBackground,
  OUTPUT_FORMATS,
  qualityFor,
  withinPixelLimit,
} from "./logic";

// The Web Worker of "Image Converter" (ADR 0051). The browser's own code does the work:
// createImageBitmap decodes the file (applying the EXIF orientation), an OffscreenCanvas holds the
// pixels and convertToBlob encodes them in the new format. No library is loaded.

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  progress({ done: 0, total: 2, stage: "Reading" });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(job.file);
  } catch {
    throw new ToolError(MESSAGES.unreadable);
  }
  try {
    signal.throwIfAborted();
    const { width, height } = bitmap;
    if (!withinPixelLimit(width, height)) throw new ToolError(MESSAGES.tooManyPixels);
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new ToolError(MESSAGES.failed);
    if (needsBackground(job.format)) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0);
    progress({ done: 1, total: 2, stage: "Converting" });
    signal.throwIfAborted();
    const { mime, label } = OUTPUT_FORMATS[job.format];
    const quality = qualityFor(job.format);
    const blob = await canvas.convertToBlob(
      quality === undefined ? { type: mime } : { type: mime, quality },
    );
    if (blob.type !== mime) throw new ToolError(MESSAGES.formatUnavailable(label));
    progress({ done: 2, total: 2 });
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
});
