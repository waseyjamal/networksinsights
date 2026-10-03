import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  checkSettings,
  fontPixels,
  type ImageType,
  type Job,
  type JobResult,
  MESSAGES,
  normalizeHex,
  placements,
  QUALITY,
  withinPixelLimit,
} from "./logic";

// The Web Worker of "Add Watermark to Image" (ADR 0051). The browser decodes the picture (and turns
// it upright), an OffscreenCanvas draws it with the text on top, and the canvas saves it in the
// same format. A browser that cannot write WebP (Safari) gives PNG, and the result says so.

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  const problems = Object.values(checkSettings(job));
  if (problems.length > 0) throw new ToolError(problems[0] ?? MESSAGES.failed);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(job.image);
  } catch {
    throw new ToolError(MESSAGES.unreadable);
  }
  try {
    const { width, height } = bitmap;
    if (!withinPixelLimit(width, height)) throw new ToolError(MESSAGES.tooManyPixels);
    progress({ done: 0, total: 2, stage: "Drawing" });
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new ToolError(MESSAGES.failed);
    if (job.type === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0);

    const text = job.text.trim();
    const px = fontPixels(width, height, job.size);
    context.font = `bold ${px}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = normalizeHex(job.color) ?? "#ffffff";
    context.globalAlpha = job.opacity / 100;
    const textWidth = context.measureText(text).width;
    const angle = (job.rotation * Math.PI) / 180;
    for (const spot of placements(width, height, textWidth, px, job.position)) {
      context.save();
      context.translate(spot.x, spot.y);
      context.rotate(angle);
      context.fillText(text, 0, 0);
      context.restore();
    }
    signal.throwIfAborted();
    progress({ done: 1, total: 2, stage: "Saving" });
    const blob = await canvas.convertToBlob(
      job.type === "image/png" ? { type: job.type } : { type: job.type, quality: QUALITY },
    );
    const written: ImageType = blob.type === job.type ? job.type : "image/png";
    progress({ done: 2, total: 2 });
    return { blob, type: written, width, height };
  } finally {
    bitmap.close();
  }
});
