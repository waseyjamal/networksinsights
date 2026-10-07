import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist";
// @ts-expect-error: pdfjs-dist ships no type declarations for its worker module.
import * as pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs";
import {
  cropBox,
  type Job,
  type JobResult,
  MESSAGES,
  PDFJS_ASSETS,
  PREVIEW_MAX_SIDE,
  seenSize,
} from "./logic";

// The Web Worker of "Crop PDF" (ADR 0051, ADR 0057). Opening a PDF checks it with pdf-lib (no
// encryption, at least one page), then PDF.js draws the first page as the preview. Cropping sets
// each page's MediaBox and CropBox (and its BleedBox, TrimBox and ArtBox) to the kept area with
// pdf-lib. Nothing on the page is redrawn or removed: what lies outside the box is hidden, and it
// is still in the file. A PDF's own scripts never run.

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

async function load(bytes: ArrayBuffer): Promise<PDFDocument> {
  let document: PDFDocument;
  let pages: number;
  try {
    document = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (document.isEncrypted) throw new ToolError(MESSAGES.encrypted);
    pages = document.getPageCount();
  } catch (caught) {
    throw caught instanceof ToolError ? caught : new ToolError(MESSAGES.unreadable);
  }
  if (pages === 0) throw new ToolError(MESSAGES.noPages);
  return document;
}

/**
 * The first page as it is seen, drawn at most PREVIEW_MAX_SIDE pixels on its longer side, or null
 * when this browser has no OffscreenCanvas in a worker: the size then comes from pdf-lib.
 */
async function preview(bytes: ArrayBuffer, document: PDFDocument) {
  const first = document.getPage(0);
  const seen = seenSize(first.getCropBox(), first.getRotation().angle);
  if (typeof OffscreenCanvas === "undefined") {
    return { blob: null, seenWidth: seen.width, seenHeight: seen.height };
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
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const scale = PREVIEW_MAX_SIDE / Math.max(seen.width, seen.height);
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new ToolError(MESSAGES.renderFailed);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      background: "#ffffff",
    }).promise;
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    return { blob, seenWidth: seen.width, seenHeight: seen.height };
  } catch (caught) {
    throw caught instanceof ToolError ? caught : new ToolError(MESSAGES.renderFailed);
  } finally {
    await task.destroy();
  }
}

defineWorker<Job, JobResult>(async (job, { signal }) => {
  const bytes = await job.file.arrayBuffer();
  const document = await load(bytes.slice(0));
  if (job.kind === "open") {
    return {
      kind: "open",
      pages: document.getPageCount(),
      preview: await preview(bytes, document),
    };
  }
  signal.throwIfAborted();
  const pages = document.getPages();
  for (const [index, page] of pages.entries()) {
    const kept = cropBox(page.getCropBox(), page.getRotation().angle, job.margins);
    if (!kept) throw new ToolError(MESSAGES.tooMuch(index + 1));
    page.setMediaBox(kept.x, kept.y, kept.width, kept.height);
    page.setCropBox(kept.x, kept.y, kept.width, kept.height);
    page.setBleedBox(kept.x, kept.y, kept.width, kept.height);
    page.setTrimBox(kept.x, kept.y, kept.width, kept.height);
    page.setArtBox(kept.x, kept.y, kept.width, kept.height);
  }
  let saved: Uint8Array;
  try {
    saved = await document.save();
  } catch {
    throw new ToolError(MESSAGES.failed);
  }
  return {
    kind: "crop",
    blob: new Blob([saved as BlobPart], { type: "application/pdf" }),
    pages: pages.length,
  };
});
