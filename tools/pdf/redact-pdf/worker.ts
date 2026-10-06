import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { PDFDocument } from "pdf-lib";
import { getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy } from "pdfjs-dist";
// @ts-expect-error: pdfjs-dist ships no type declarations for its worker module.
import * as pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs";
import {
  type Box,
  boxPixels,
  checkBoxes,
  checkPages,
  type Job,
  type JobResult,
  MAX_SIDE,
  MESSAGES,
  PDFJS_ASSETS,
  PREVIEW_MAX_SIDE,
  QUALITY,
  REDACT_DPI,
  redactedPages,
  renderSize,
} from "./logic";

// The Web Worker of "Redact PDF" (ADR 0051, ADR 0057). Opening a PDF checks it with pdf-lib (no
// encryption, a page count within the limit), then PDF.js keeps it open to draw pages on an
// OffscreenCanvas. Redacting draws each page that has boxes at 150 dpi (at most 4,096 pixels a
// side), paints the boxes solid black into the pixels, and saves the page as a JPG. A new PDF is
// then built: those pages are only the picture, and every other page is copied from the original
// with pdf-lib, which copies only what the page uses. The original's pages with boxes are not
// copied at all, so their text is not in the new file. A PDF's own scripts never run.

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

/** Canvases for PDF.js, with no document. */
class OffscreenCanvasFactory {
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(target: { canvas: OffscreenCanvas | null }, width: number, height: number) {
    if (!target.canvas) throw new Error("Canvas is not specified");
    target.canvas.width = width;
    target.canvas.height = height;
  }
  destroy(target: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (target.canvas) {
      target.canvas.width = 0;
      target.canvas.height = 0;
    }
    target.canvas = null;
    target.context = null;
  }
}

/** No SVG filters in a worker: PDF.js then draws without them, as it does in Node. */
class NoFilterFactory {
  addFilter() {
    return "none";
  }
  addHCMFilter() {
    return "none";
  }
  addAlphaFilter() {
    return "none";
  }
  addLuminosityFilter() {
    return "none";
  }
  addKnockoutFilter() {
    return "none";
  }
  addHighlightHCMFilter() {
    return "none";
  }
  addSelectionHCMFilter() {
    return "none";
  }
  destroy() {}
}

/** The PDF being redacted, kept open between jobs so each page is drawn without reading it again. */
let current: { task: PDFDocumentLoadingTask; document: PDFDocumentProxy } | null = null;

async function load(bytes: ArrayBuffer): Promise<PDFDocument> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw new ToolError(MESSAGES.unreadable);
  }
  if (document.isEncrypted) throw new ToolError(MESSAGES.encrypted);
  return document;
}

async function open(file: Blob): Promise<number> {
  if (current) {
    await current.task.destroy();
    current = null;
  }
  const bytes = await file.arrayBuffer();
  const pages = (await load(bytes.slice(0))).getPageCount();
  const problem = checkPages(pages);
  if (problem) throw new ToolError(problem);
  const base = new URL(PDFJS_ASSETS, self.location.origin).href;
  const task = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    isOffscreenCanvasSupported: true,
    useWorkerFetch: true,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
    CanvasFactory: OffscreenCanvasFactory,
    FilterFactory: NoFilterFactory,
    verbosity: 0,
  } as Parameters<typeof getDocument>[0]);
  try {
    current = { task, document: await task.promise };
  } catch (caught) {
    await task.destroy();
    if ((caught as { name?: string }).name === "PasswordException")
      throw new ToolError(MESSAGES.encrypted);
    throw new ToolError(MESSAGES.unreadable);
  }
  return pages;
}

/** Draws one page, with its boxes painted black, as a JPG of the size `fit` gives. */
async function draw(number: number, boxes: readonly Box[], maxSide: number, dpi: number) {
  if (!current) throw new ToolError(MESSAGES.renderFailed);
  const page = await current.document.getPage(number);
  try {
    const base = page.getViewport({ scale: 1 });
    const size = renderSize(base.width, base.height, maxSide, dpi);
    const viewport = page.getViewport({
      scale: Math.min(size.width / base.width, size.height / base.height),
    });
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    if (!context) throw new ToolError(MESSAGES.renderFailed);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      background: "#ffffff",
    }).promise;
    context.fillStyle = "#000000";
    for (const box of boxes) {
      const area = boxPixels(box, size.width, size.height);
      context.fillRect(area.x, area.y, area.width, area.height);
    }
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: QUALITY });
    canvas.width = 0;
    canvas.height = 0;
    return { blob, seenWidth: base.width, seenHeight: base.height };
  } catch (caught) {
    throw caught instanceof ToolError ? caught : new ToolError(MESSAGES.renderFailed);
  } finally {
    page.cleanup();
  }
}

async function redact(
  job: Extract<Job, { kind: "redact" }>,
  progress: (done: number, total: number) => void,
) {
  const problem = checkBoxes(job.boxes);
  if (problem) throw new ToolError(problem);
  const original = await load(await job.file.arrayBuffer());
  const count = original.getPageCount();
  const marked = new Set(redactedPages(job.boxes));
  const output = await PDFDocument.create();
  // Only these four properties are carried over; pdf-lib writes its own producer and dates.
  const title = original.getTitle();
  const author = original.getAuthor();
  const subject = original.getSubject();
  const keywords = original.getKeywords();
  if (title) output.setTitle(title);
  if (author) output.setAuthor(author);
  if (subject) output.setSubject(subject);
  if (keywords) output.setKeywords(keywords.split(/\s+/));
  for (let index = 0; index < count; index++) {
    progress(index, count);
    const number = index + 1;
    if (marked.has(number)) {
      const drawn = await draw(
        number,
        job.boxes.filter((box) => box.page === number),
        MAX_SIDE,
        REDACT_DPI,
      );
      const image = await output.embedJpg(await drawn.blob.arrayBuffer());
      const page = output.addPage([drawn.seenWidth, drawn.seenHeight]);
      page.drawImage(image, { x: 0, y: 0, width: drawn.seenWidth, height: drawn.seenHeight });
    } else {
      const [copied] = await output.copyPages(original, [index]);
      if (copied) output.addPage(copied);
    }
  }
  const bytes = await output.save();
  return {
    blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    redacted: [...marked],
    pages: count,
  };
}

defineWorker<Job, JobResult>(async (job, { progress }) => {
  if (job.kind === "open") return { kind: "open", pages: await open(job.file) };
  if (job.kind === "render") {
    const drawn = await draw(job.page, [], PREVIEW_MAX_SIDE, 1000);
    return { kind: "render", view: { page: job.page, ...drawn } };
  }
  try {
    const done = await redact(job, (done, total) => progress({ done, total }));
    return { kind: "redact", ...done };
  } catch (caught) {
    throw caught instanceof ToolError ? caught : new ToolError(MESSAGES.failed);
  }
});
