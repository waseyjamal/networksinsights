import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { getDocument } from "pdfjs-dist";
// @ts-expect-error: pdfjs-dist ships no type declarations for its worker module.
import * as pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs";
import {
  type Job,
  type JobResult,
  MESSAGES,
  PDFJS_ASSETS,
  type ProtectionKind,
  type Reading,
  verified,
} from "./logic";

// The Web Worker of "Unlock PDF" (ADR 0057, ADR 0062). PDFium, compiled to WebAssembly by
// @embedpdf/pdfium, opens the PDF with the password the visitor typed. It never tries another
// password. A PDF that asks for a password to open is opened with it; a PDF that opens freely
// but limits printing or changes must be given its owner password. PDFium then removes the
// protection and saves a copy. PDF.js opens that copy with no password and reads every page:
// the copy is given back only when its pages and text match the original's, read by PDF.js with
// the password. A PDF's own scripts never run.

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

type Pdfium = WrappedPdfiumModule;

interface Memory {
  malloc(size: number): number;
  free(pointer: number): void;
  memory: WebAssembly.Memory;
}

/** PDFium's FPDF_GetLastError code for a PDF that needs a password. */
const ERROR_PASSWORD = 4;

let loading: Promise<Pdfium> | undefined;

function pdfium(): Promise<Pdfium> {
  loading ??= init({ print: () => {}, printErr: () => {} })
    .then((module) => {
      module.PDFiumExt_Init();
      return module;
    })
    .catch((caught) => {
      loading = undefined;
      throw caught;
    });
  return loading;
}

const memoryOf = (module: Pdfium) => module.pdfium.wasmExports as unknown as Memory;
const heap = (module: Pdfium) => new Uint8Array(memoryOf(module).memory.buffer);

/** The document saved as new bytes. */
function save(module: Pdfium, document: number): Uint8Array {
  const writer = module.PDFiumExt_OpenFileWriter();
  try {
    if (!module.PDFiumExt_SaveAsCopy(document, writer)) throw new ToolError(MESSAGES.failed);
    const size = module.PDFiumExt_GetFileWriterSize(writer);
    const pointer = memoryOf(module).malloc(size);
    module.PDFiumExt_GetFileWriterData(writer, pointer, size);
    const bytes = heap(module).slice(pointer, pointer + size);
    memoryOf(module).free(pointer);
    return bytes;
  } finally {
    module.PDFiumExt_CloseFileWriter(writer);
  }
}

/** Opens the PDF with the typed password, removes its protection and saves a copy. */
function unlock(
  module: Pdfium,
  bytes: Uint8Array,
  password: string,
): { bytes: Uint8Array; kind: ProtectionKind; pages: number } {
  const pointer = memoryOf(module).malloc(bytes.length);
  heap(module).set(bytes, pointer);
  let handle = 0;
  try {
    // First without a password: a PDF that opens freely is either unprotected or owner-locked.
    handle = module.FPDF_LoadMemDocument(pointer, bytes.length, "");
    let kind: ProtectionKind;
    if (handle) {
      if (module.FPDF_GetSecurityHandlerRevision(handle) === -1) {
        throw new ToolError(MESSAGES.notProtected);
      }
      if (!module.EPDF_UnlockOwnerPermissions(handle, password)) {
        throw new ToolError(MESSAGES.wrongPassword);
      }
      kind = "owner";
    } else {
      const code = module.FPDF_GetLastError();
      if (code !== ERROR_PASSWORD) throw new ToolError(MESSAGES.unreadable);
      handle = module.FPDF_LoadMemDocument(pointer, bytes.length, password);
      if (!handle) {
        throw new ToolError(
          module.FPDF_GetLastError() === ERROR_PASSWORD
            ? MESSAGES.wrongPassword
            : MESSAGES.unreadable,
        );
      }
      kind = "open";
    }
    if (!module.EPDF_RemoveEncryption(handle)) throw new ToolError(MESSAGES.failed);
    return { bytes: save(module, handle), kind, pages: module.FPDF_GetPageCount(handle) };
  } finally {
    if (handle) module.FPDF_CloseDocument(handle);
    memoryOf(module).free(pointer);
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

const origin = () => self.location.origin;

/** PDF.js reads every page's text, with the password when one is given. */
async function read(bytes: Uint8Array, password?: string): Promise<Reading> {
  const base = new URL(PDFJS_ASSETS, origin()).href;
  const task = getDocument({
    // PDF.js may take over the buffer it is given: give it a copy.
    data: bytes.slice(),
    ...(password === undefined ? {} : { password }),
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
    const document = await task.promise;
    const texts: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      texts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(""));
      page.cleanup();
    }
    return { locked: false, texts };
  } catch (caught) {
    if ((caught as { name?: string }).name === "PasswordException") return { locked: true };
    throw caught;
  } finally {
    await task.destroy();
  }
}

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  progress({ done: 0, total: 3, stage: "Opening" });
  const bytes = new Uint8Array(await job.file.arrayBuffer());
  const module = await pdfium();
  signal.throwIfAborted();
  const unlocked = unlock(module, bytes, job.password);
  progress({ done: 1, total: 3, stage: "Checking" });
  let original: Reading;
  let copy: Reading;
  try {
    original = await read(bytes, job.password);
    signal.throwIfAborted();
    progress({ done: 2, total: 3, stage: "Checking" });
    copy = await read(unlocked.bytes);
  } catch {
    throw new ToolError(MESSAGES.notVerified);
  }
  if (!verified(original, copy)) throw new ToolError(MESSAGES.notVerified);
  progress({ done: 3, total: 3 });
  return unlocked;
});
