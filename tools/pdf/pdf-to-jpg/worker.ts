import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy } from "pdfjs-dist";
// @ts-expect-error: pdfjs-dist ships no type declarations for its worker module.
import * as pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs";
import {
  type Job,
  type JobResult,
  MESSAGES,
  PDFJS_ASSETS,
  type Picture,
  pictureSize,
  QUALITIES,
  renderScale,
} from "./logic";

// The Web Worker of "PDF to JPG" (ADR 0051, ADR 0057). PDF.js reads the PDF and draws each page
// on an OffscreenCanvas, which writes the JPG. PDF.js normally starts a worker of its own; here it
// is already in one, so its worker code runs in this thread (`globalThis.pdfjsWorker`). There is
// no DOM in a worker, so canvases come from OffscreenCanvas, fonts are drawn as shapes
// (`disableFontFace`) and no SVG filter is made. A PDF's own scripts never run
// (`isEvalSupported: false`, `enableScripting: false`). Data files come from our own origin.

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

const origin = () => self.location.origin;

async function open(
  file: Blob,
): Promise<{ task: PDFDocumentLoadingTask; document: PDFDocumentProxy }> {
  const data = new Uint8Array(await file.arrayBuffer());
  const base = new URL(PDFJS_ASSETS, origin()).href;
  const task = getDocument({
    data,
    isEvalSupported: false,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    isOffscreenCanvasSupported: true,
    // Set, so PDF.js does not read `document.baseURI` to decide it: there is no document here.
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
    return { task, document: await task.promise };
  } catch (caught) {
    await task.destroy();
    if ((caught as { name?: string }).name === "PasswordException") {
      throw new ToolError(MESSAGES.encrypted);
    }
    throw new ToolError(MESSAGES.unreadable);
  }
}

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  const { task, document } = await open(job.file);
  try {
    if (document.numPages === 0) throw new ToolError(MESSAGES.noPages);
    if (job.kind === "count") return { kind: "count", pages: document.numPages };

    const pictures: Picture[] = [];
    const quality = QUALITIES[job.quality].value;
    for (const [index, number] of job.pages.entries()) {
      signal.throwIfAborted();
      progress({ done: index, total: job.pages.length, stage: `Page ${number}` });
      const page = await document.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const scale = renderScale(base.width, base.height, job.resolution);
      const size = pictureSize(base.width, base.height, scale);
      const viewport = page.getViewport({
        scale: Math.min(size.width / base.width, size.height / base.height),
      });
      const canvas = new OffscreenCanvas(size.width, size.height);
      const context = canvas.getContext("2d");
      if (!context) throw new ToolError(MESSAGES.failed);
      // JPG has no transparency: pages are drawn on white paper.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size.width, size.height);
      try {
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport,
          background: "#ffffff",
        }).promise;
      } catch {
        throw new ToolError(MESSAGES.failed);
      } finally {
        page.cleanup();
      }
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
      pictures.push({ page: number, blob, width: size.width, height: size.height });
    }
    progress({ done: job.pages.length, total: job.pages.length });
    return { kind: "render", pictures };
  } finally {
    await task.destroy();
  }
});
