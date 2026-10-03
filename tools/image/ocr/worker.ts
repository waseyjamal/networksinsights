import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy } from "pdfjs-dist";
// @ts-expect-error: pdfjs-dist ships no type declarations for its worker module.
import * as pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs";
import { createWorker, OEM, type Worker as TesseractWorker } from "tesseract.js";
import {
  type Job,
  type JobResult,
  languagesOf,
  MESSAGES,
  type PageText,
  PDFJS_ASSETS,
  pdfScale,
  readSize,
  TESSERACT_ASSETS,
  withinPageLimit,
} from "./logic";

// The Web Worker of "OCR image to text" (ADR 0051, ADR 0057, ADR 0060). A photo is decoded by the
// browser and, when larger than 4,000 pixels on a side, scaled down; a PDF's pages are drawn by
// PDF.js at 300 dpi. Tesseract then reads the text in a worker of its own, started from this one:
// its worker script, its engine (with SIMD where the browser has it, run in LSTM mode) and the
// chosen language data all come from this site, never a CDN. The full core, not the smaller
// LSTM-only build, is used: the Hindi data names parameters only the full core knows, and the
// LSTM-only build prints a warning to the console for each one. Only the chosen languages are downloaded,
// and nothing is cached by tesseract.js itself (`cacheMethod: "none"`): the browser's own HTTP
// cache keeps the files.

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

/** wasm-feature-detect's SIMD probe: a module that validates only where SIMD is supported. */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
]);

const assets = (path: string) => new URL(`${TESSERACT_ASSETS}${path}`, self.location.origin).href;

/** One Tesseract worker, kept for the next run while the languages stay the same. */
let current: { languages: string; worker: Promise<TesseractWorker> } | undefined;

type Report = (stage: string) => void;
let report: Report = () => {};

function tesseract(languages: readonly string[]): Promise<TesseractWorker> {
  const key = languages.join("+");
  if (current?.languages === key) return current.worker;
  const previous = current;
  if (previous) void previous.worker.then((worker) => worker.terminate()).catch(() => {});
  const core = WebAssembly.validate(SIMD_PROBE) ? "tesseract-core-simd.js" : "tesseract-core.js";
  const worker = createWorker([...languages], OEM.LSTM_ONLY, {
    workerPath: assets("worker.min.js"),
    workerBlobURL: false,
    corePath: assets(core),
    langPath: assets("lang"),
    gzip: true,
    cacheMethod: "none",
    logger: (message: { status: string }) => {
      if (/loading tesseract core/.test(message.status)) report("Loading the OCR engine");
      else if (/loading language/.test(message.status)) report("Downloading the language data");
      else if (/initializ/.test(message.status)) report("Starting the OCR engine");
    },
    errorHandler: () => {},
  }).catch((caught: unknown) => {
    if (current?.worker === worker) current = undefined;
    throw caught;
  });
  current = { languages: key, worker };
  return worker;
}

async function read(worker: TesseractWorker, picture: Blob): Promise<string> {
  const { data } = await worker.recognize(picture);
  return data.text;
}

/** A picture Tesseract can read: the photo as decoded, scaled down to 4,000 pixels at most. */
async function preparePhoto(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ToolError(MESSAGES.unreadableImage);
  }
  try {
    const size = readSize(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    if (!context) throw new ToolError(MESSAGES.failed);
    // Transparent areas read as white paper, not black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    bitmap.close();
  }
}

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

async function openPdf(
  file: Blob,
): Promise<{ task: PDFDocumentLoadingTask; document: PDFDocumentProxy }> {
  const data = new Uint8Array(await file.arrayBuffer());
  const base = new URL(PDFJS_ASSETS, self.location.origin).href;
  const task = getDocument({
    data,
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
    return { task, document: await task.promise };
  } catch (caught) {
    await task.destroy();
    if ((caught as { name?: string }).name === "PasswordException") {
      throw new ToolError(MESSAGES.encrypted);
    }
    throw new ToolError(MESSAGES.unreadablePdf);
  }
}

/** One PDF page drawn on white at 300 dpi, within 4,000 pixels, as a PNG. */
async function drawPage(document: PDFDocumentProxy, number: number): Promise<Blob> {
  const page = await document.getPage(number);
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: pdfScale(base.width, base.height) });
    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new ToolError(MESSAGES.failed);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      background: "#ffffff",
    }).promise;
    return await canvas.convertToBlob({ type: "image/png" });
  } catch (caught) {
    if (caught instanceof ToolError) throw caught;
    throw new ToolError(MESSAGES.unreadablePdf);
  } finally {
    page.cleanup();
  }
}

async function engine(languages: readonly string[]): Promise<TesseractWorker> {
  try {
    return await tesseract(languages);
  } catch {
    throw new ToolError(MESSAGES.engine);
  }
}

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  const languages = languagesOf(job.language);

  if (job.kind === "image") {
    const total = 2;
    report = (stage) => progress({ done: 0, total, stage });
    const picture = await preparePhoto(job.file);
    signal.throwIfAborted();
    const worker = await engine(languages);
    signal.throwIfAborted();
    progress({ done: 1, total, stage: "Reading the text" });
    const text = await read(worker, picture).catch(() => {
      throw new ToolError(MESSAGES.failed);
    });
    progress({ done: total, total });
    return { pages: [{ page: 1, text }] };
  }

  const { task, document } = await openPdf(job.file);
  try {
    if (document.numPages === 0) throw new ToolError(MESSAGES.noPages);
    if (!withinPageLimit(document.numPages)) {
      throw new ToolError(MESSAGES.tooManyPages(document.numPages));
    }
    const total = document.numPages + 1;
    report = (stage) => progress({ done: 0, total, stage });
    report("Starting the OCR engine");
    const worker = await engine(languages);
    const pages: PageText[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      signal.throwIfAborted();
      progress({ done: number, total, stage: `Reading page ${number} of ${document.numPages}` });
      const picture = await drawPage(document, number);
      const text = await read(worker, picture).catch(() => {
        throw new ToolError(MESSAGES.failed);
      });
      pages.push({ page: number, text });
    }
    progress({ done: total, total });
    return { pages };
  } finally {
    await task.destroy();
  }
});
