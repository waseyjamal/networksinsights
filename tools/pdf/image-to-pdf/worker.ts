import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { PDFDocument } from "pdf-lib";
import {
  embedAs,
  imageTypeOf,
  type Job,
  type JobResult,
  JPG_QUALITY,
  layout,
  MESSAGES,
  withinPixelLimit,
} from "./logic";

// The Web Worker of "Image to PDF" (ADR 0051, ADR 0057). The browser decodes each picture (and
// turns it upright), an OffscreenCanvas saves it as JPG or PNG, and pdf-lib puts it on a page of
// its own. pdf-lib loads with this worker, so its code is fetched only when the visitor starts.

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  if (job.images.length === 0) throw new ToolError(MESSAGES.needOne);
  const document = await PDFDocument.create();
  const total = job.images.length + 1;
  for (const [index, image] of job.images.entries()) {
    signal.throwIfAborted();
    progress({ done: index, total, stage: `Adding ${image.name}` });
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(image.data);
    } catch {
      throw new ToolError(MESSAGES.unreadable(image.name));
    }
    try {
      const { width, height } = bitmap;
      if (!withinPixelLimit(width, height)) throw new ToolError(MESSAGES.tooManyPixels(image.name));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new ToolError(MESSAGES.failed);
      const kind = embedAs(imageTypeOf({ name: image.name, type: image.data.type }) ?? "image/png");
      if (kind === "jpg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
      }
      context.drawImage(bitmap, 0, 0);
      const encoded = await canvas.convertToBlob(
        kind === "jpg" ? { type: "image/jpeg", quality: JPG_QUALITY } : { type: "image/png" },
      );
      const bytes = new Uint8Array(await encoded.arrayBuffer());
      const embedded =
        kind === "jpg" ? await document.embedJpg(bytes) : await document.embedPng(bytes);
      const place = layout(width, height, job);
      const page = document.addPage([place.pageWidth, place.pageHeight]);
      page.drawImage(embedded, {
        x: place.x,
        y: place.y,
        width: place.width,
        height: place.height,
      });
    } finally {
      bitmap.close();
    }
  }
  signal.throwIfAborted();
  progress({ done: job.images.length, total, stage: "Saving" });
  const saved = await document.save();
  progress({ done: total, total });
  return {
    blob: new Blob([saved as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
    pages: document.getPageCount(),
  };
});
