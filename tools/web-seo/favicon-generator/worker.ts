import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  buildIco,
  centreSquare,
  ICO_NAME,
  ICO_SIZES,
  ICONS,
  type Job,
  type JobResult,
  MESSAGES,
  type OutputFile,
  withinPixelLimit,
} from "./logic";

// The Web Worker of "Favicon Generator" (ADR 0051). The browser decodes the image, the largest
// centred square is drawn at each size on an OffscreenCanvas and saved as PNG, and the three
// smallest PNG files are packed into favicon.ico by logic.ts. No library.

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(job.image);
  } catch {
    throw new ToolError(MESSAGES.unreadable);
  }
  try {
    const { width, height } = bitmap;
    if (!withinPixelLimit(width, height)) throw new ToolError(MESSAGES.tooManyPixels);
    const square = centreSquare(width, height);
    const files: OutputFile[] = [];
    const pngs = new Map<number, Uint8Array>();
    const total = ICONS.length + 1;
    for (const [index, icon] of ICONS.entries()) {
      signal.throwIfAborted();
      progress({ done: index, total, stage: `Drawing ${icon.name}` });
      const canvas = new OffscreenCanvas(icon.size, icon.size);
      const context = canvas.getContext("2d");
      if (!context) throw new ToolError(MESSAGES.failed);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        bitmap,
        square.x,
        square.y,
        square.side,
        square.side,
        0,
        0,
        icon.size,
        icon.size,
      );
      const blob = await canvas.convertToBlob({ type: "image/png" });
      pngs.set(icon.size, new Uint8Array(await blob.arrayBuffer()));
      files.push({ name: icon.name, size: icon.size, blob });
    }
    const ico = buildIco(
      ICO_SIZES.map((size) => {
        const png = pngs.get(size);
        if (!png) throw new ToolError(MESSAGES.failed);
        return { size, png };
      }),
    );
    files.unshift({
      name: ICO_NAME,
      size: 48,
      blob: new Blob([ico as Uint8Array<ArrayBuffer>], { type: "image/x-icon" }),
    });
    progress({ done: total, total });
    return { files, width, height, cropped: width !== height };
  } finally {
    bitmap.close();
  }
});
