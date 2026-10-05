import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist";
// @ts-expect-error: pdfjs-dist ships no type declarations for its worker module.
import * as pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs";
import {
  checkOrder,
  checkPageCount,
  type Job,
  type JobResult,
  MESSAGES,
  PDFJS_ASSETS,
  type Thumb,
  thumbScale,
} from "./logic";

// The Web Worker of "Delete and Reorder PDF Pages" (ADR 0051, ADR 0057). Opening a PDF: pdf-lib
// refuses a protected file and counts the pages, then PDF.js draws a small thumbnail of each page on
// an OffscreenCanvas. Building: pdf-lib copies the kept pages, in the new order, into a new PDF;
// nothing on a page is redrawn. PDF.js runs its own worker code in this thread
// (`globalThis.pdfjsWorker`), never runs a PDF's scripts, and loads its data files from this site.

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

/** Canvases for PDF.js, with no document. */
class OffscreenCanvasFactory {
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d", { willReadFrequently: true }) };
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

async function load(bytes: ArrayBuffer): Promise<PDFDocument> {
  let document: PDFDocument;
  let pages: number;
  try {
    document = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (document.isEncrypted) throw new ToolError(MESSAGES.encrypted);
    // A damaged file can load and still have no page tree: counting the pages finds out.
    pages = document.getPageCount();
  } catch (caught) {
    throw caught instanceof ToolError ? caught : new ToolError(MESSAGES.unreadable);
  }
  const problem = checkPageCount(pages);
  if (problem) throw new ToolError(problem);
  return document;
}

/** A thumbnail of every page. A page this browser cannot draw gets none, and the tool still works. */
async function thumbnails(
  bytes: ArrayBuffer,
  pages: number,
  progress: (value: { done: number; total: number }) => void,
  signal: { aborted: boolean; throwIfAborted(): void },
): Promise<Thumb[]> {
  const empty = (page: number): Thumb => ({ page, blob: null, width: 0, height: 0 });
  if (typeof OffscreenCanvas === "undefined") {
    return Array.from({ length: pages }, (_, index) => empty(index + 1));
  }
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
  const thumbs: Thumb[] = [];
  try {
    const document = await task.promise;
    for (let number = 1; number <= pages; number++) {
      signal.throwIfAborted();
      progress({ done: number - 1, total: pages });
      try {
        const page = await document.getPage(number);
        const unit = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: thumbScale(unit.width, unit.height) });
        const width = Math.max(1, Math.round(viewport.width));
        const height = Math.max(1, Math.round(viewport.height));
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no context");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport,
          background: "#ffffff",
        }).promise;
        page.cleanup();
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
        thumbs.push({ page: number, blob, width, height });
      } catch {
        thumbs.push(empty(number));
      }
    }
  } catch (caught) {
    if (signal.aborted) throw caught;
    for (let number = thumbs.length + 1; number <= pages; number++) thumbs.push(empty(number));
  } finally {
    await task.destroy();
  }
  progress({ done: pages, total: pages });
  return thumbs;
}

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  const bytes = await job.file.arrayBuffer();
  // PDF.js may take over the buffer it is given, so pdf-lib reads its own copy first.
  const source = await load(bytes.slice(0));
  const pages = source.getPageCount();
  if (job.kind === "open") {
    return { kind: "open", pages, thumbs: await thumbnails(bytes, pages, progress, signal) };
  }
  const checked = checkOrder(job.order, pages);
  if (!checked.ok) throw new ToolError(checked.error);
  signal.throwIfAborted();
  try {
    const output = await PDFDocument.create();
    const copied = await output.copyPages(
      source,
      job.order.map((page) => page - 1),
    );
    for (const page of copied) output.addPage(page);
    const saved = await output.save();
    return {
      kind: "build",
      blob: new Blob([saved as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
    };
  } catch {
    throw new ToolError(MESSAGES.failed);
  }
});
