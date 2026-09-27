import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  type Job,
  type JobResult,
  MESSAGES,
  OUTPUT_FORMATS,
  QUALITY_LEVELS,
  withinPixelLimit,
} from "./logic";

// The Web Worker of "Compress Image" (ADR 0051). Everything here is the browser's own code:
// createImageBitmap decodes the file, an OffscreenCanvas holds the pixels and convertToBlob encodes
// them. Nothing is uploaded and no library is loaded. Re-encoding keeps only the pixels, so camera
// metadata such as the location is not in the result; createImageBitmap applies the EXIF
// orientation first, so the picture keeps its orientation.

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  const { mime, label } = OUTPUT_FORMATS[job.format];
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
    if (job.format === "jpg") {
      // JPG has no transparency: transparent areas become white rather than black.
      context.fillStyle = "white";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0);
    progress({ done: 1, total: 2, stage: "Compressing" });

    let blob: Blob;
    try {
      blob = await canvas.convertToBlob({ type: mime, quality: QUALITY_LEVELS[job.quality].value });
    } catch {
      throw new ToolError(MESSAGES.failed);
    }
    // A browser without an encoder for the type gives PNG instead of an error.
    if (blob.type !== mime) throw new ToolError(MESSAGES.formatUnavailable(label));
    signal.throwIfAborted();
    progress({ done: 2, total: 2, stage: "Done" });
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
});
