import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  BITMAP_FORMATS,
  checkPages,
  hasTransparency,
  type ImageCounts,
  type Job,
  type JobResult,
  LEVELS,
  MESSAGES,
  sameText,
  skipReason,
  targetSize,
  toRgba,
  worthReplacing,
} from "./logic";

// The Web Worker of "Compress PDF" (ADR 0062). PDFium, compiled to WebAssembly by
// @embedpdf/pdfium, opens the PDF; each picture on each page that has no transparency, is not too
// large and uses plain grey or RGB colours is decoded, brought down to the level's resolution
// where it is shown larger than that, and encoded again as JPEG by an OffscreenCanvas. The new
// JPEG replaces the picture only when it is clearly smaller. Text, fonts and drawings are not
// touched. Before anything is returned, the new file is opened again and the text of every page
// is compared with the original's: if any differs, nothing is returned. The .wasm file is a
// separate, content-hashed file that Vite emits from the package, fetched on the first job.

type Pdfium = WrappedPdfiumModule;

interface Memory {
  malloc(size: number): number;
  free(pointer: number): void;
  memory: WebAssembly.Memory;
}

/** PDFium's FPDF_GetLastError code for a PDF that needs a password. */
const ERROR_PASSWORD = 4;
/** PDFium's page object type for a picture. */
const IMAGE_OBJECT = 3;
/** Size of FPDF_IMAGEOBJ_METADATA: width, height, two DPI floats, bits a pixel, colour space, id. */
const METADATA_BYTES = 28;

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

/** Copies bytes into WebAssembly memory. The caller frees the pointer. */
function place(module: Pdfium, bytes: Uint8Array): number {
  const pointer = memoryOf(module).malloc(bytes.length);
  heap(module).set(bytes, pointer);
  return pointer;
}

interface OpenDocument {
  handle: number;
  pointer: number;
  pages: number;
}

/** Opens a PDF from bytes, refusing a protected or unreadable one. */
function open(module: Pdfium, bytes: Uint8Array): OpenDocument {
  const pointer = place(module, bytes);
  const handle = module.FPDF_LoadMemDocument(pointer, bytes.length, "");
  if (!handle) {
    const code = module.FPDF_GetLastError();
    memoryOf(module).free(pointer);
    throw new ToolError(code === ERROR_PASSWORD ? MESSAGES.encrypted : MESSAGES.unreadable);
  }
  // A PDF with only an owner password opens without one, but it is still protected.
  if (module.FPDF_GetSecurityHandlerRevision(handle) !== -1) {
    close(module, { handle, pointer, pages: 0 });
    throw new ToolError(MESSAGES.encrypted);
  }
  return { handle, pointer, pages: module.FPDF_GetPageCount(handle) };
}

function close(module: Pdfium, document: OpenDocument) {
  module.FPDF_CloseDocument(document.handle);
  memoryOf(module).free(document.pointer);
}

/** The text of a loaded page, as PDFium reads it. */
function pageText(module: Pdfium, page: number): string {
  const textPage = module.FPDFText_LoadPage(page);
  if (!textPage) return "";
  const count = module.FPDFText_CountChars(textPage);
  let text = "";
  if (count > 0) {
    const buffer = memoryOf(module).malloc((count + 1) * 2);
    module.FPDFText_GetText(textPage, 0, count, buffer);
    text = module.pdfium.UTF16ToString(buffer);
    memoryOf(module).free(buffer);
  }
  module.FPDFText_ClosePage(textPage);
  return text;
}

/** Whether a picture shows any transparency once its mask is applied. */
function seeThrough(module: Pdfium, document: number, page: number, image: number): boolean {
  const bitmap = module.FPDFImageObj_GetRenderedBitmap(document, page, image);
  if (!bitmap) return true;
  try {
    if (module.FPDFBitmap_GetFormat(bitmap) !== BITMAP_FORMATS.bgra) return false;
    const width = module.FPDFBitmap_GetWidth(bitmap);
    const height = module.FPDFBitmap_GetHeight(bitmap);
    const stride = module.FPDFBitmap_GetStride(bitmap);
    const start = module.FPDFBitmap_GetBuffer(bitmap);
    return hasTransparency(
      heap(module).subarray(start, start + stride * height),
      width,
      height,
      stride,
    );
  } finally {
    module.FPDFBitmap_Destroy(bitmap);
  }
}

/** The picture's pixels as a new JPEG at the target resolution, or null if it cannot be read. */
async function reencode(
  module: Pdfium,
  image: number,
  shownDpi: number,
  level: (typeof LEVELS)[keyof typeof LEVELS],
): Promise<Uint8Array | null> {
  const bitmap = module.FPDFImageObj_GetBitmap(image);
  if (!bitmap) return null;
  let pixels: Uint8ClampedArray<ArrayBuffer> | null;
  let width: number;
  let height: number;
  try {
    width = module.FPDFBitmap_GetWidth(bitmap);
    height = module.FPDFBitmap_GetHeight(bitmap);
    const stride = module.FPDFBitmap_GetStride(bitmap);
    const start = module.FPDFBitmap_GetBuffer(bitmap);
    const source = heap(module).subarray(start, start + stride * height);
    pixels = toRgba(source, width, height, stride, module.FPDFBitmap_GetFormat(bitmap));
  } finally {
    module.FPDFBitmap_Destroy(bitmap);
  }
  if (!pixels) return null;
  const full = new OffscreenCanvas(width, height);
  full.getContext("2d")?.putImageData(new ImageData(pixels, width, height), 0, 0);
  const size = targetSize(width, height, shownDpi, level.dpi);
  const out = new OffscreenCanvas(size.width, size.height);
  const context = out.getContext("2d");
  if (!context) return null;
  context.imageSmoothingQuality = "high";
  context.drawImage(full, 0, 0, size.width, size.height);
  const blob = await out.convertToBlob({ type: "image/jpeg", quality: level.quality });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Recompresses the pictures of one loaded page. Returns whether any picture was replaced. */
async function compressPage(
  module: Pdfium,
  document: number,
  page: number,
  level: (typeof LEVELS)[keyof typeof LEVELS],
  counts: ImageCounts,
): Promise<boolean> {
  const metadata = memoryOf(module).malloc(METADATA_BYTES);
  let changed = false;
  try {
    const objects = module.FPDFPage_CountObjects(page);
    for (let index = 0; index < objects; index++) {
      const image = module.FPDFPage_GetObject(page, index);
      if (module.FPDFPageObj_GetType(image) !== IMAGE_OBJECT) continue;
      counts.found++;
      if (!module.FPDFImageObj_GetImageMetadata(image, page, metadata)) {
        counts.kept++;
        continue;
      }
      const view = new DataView(memoryOf(module).memory.buffer, metadata, METADATA_BYTES);
      const facts = {
        width: view.getUint32(0, true),
        height: view.getUint32(4, true),
        bitsPerPixel: view.getUint32(16, true),
        colorSpace: view.getInt32(20, true),
      };
      const shownDpi = view.getFloat32(8, true);
      if (skipReason(facts)) {
        counts.kept++;
        continue;
      }
      if (seeThrough(module, document, page, image)) {
        counts.transparent++;
        continue;
      }
      const original = module.FPDFImageObj_GetImageDataRaw(image, 0, 0);
      const jpeg = await reencode(module, image, shownDpi, level);
      if (!jpeg || !worthReplacing(jpeg.length, original)) {
        counts.kept++;
        continue;
      }
      const pointer = place(module, jpeg);
      const replaced = module.EPDFImageObj_SetJpeg(page, 0, image, pointer, jpeg.length);
      memoryOf(module).free(pointer);
      if (replaced) {
        counts.recompressed++;
        changed = true;
      } else {
        counts.kept++;
      }
    }
  } finally {
    memoryOf(module).free(metadata);
  }
  return changed;
}

/** The whole document saved as new bytes. */
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

/** The text of every page of a saved PDF, to compare with the original's. */
function textsOf(module: Pdfium, bytes: Uint8Array): string[] | null {
  let document: OpenDocument;
  try {
    document = open(module, bytes);
  } catch {
    return null;
  }
  try {
    const texts: string[] = [];
    for (let index = 0; index < document.pages; index++) {
      const page = module.FPDF_LoadPage(document.handle, index);
      if (!page) return null;
      texts.push(pageText(module, page));
      module.FPDF_ClosePage(page);
    }
    return texts;
  } finally {
    close(module, document);
  }
}

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  const level = LEVELS[job.level];
  const input = new Uint8Array(await job.file.arrayBuffer());
  let module: Pdfium;
  try {
    module = await pdfium();
  } catch {
    throw new ToolError(MESSAGES.failed);
  }
  const document = open(module, input);
  const counts: ImageCounts = { found: 0, recompressed: 0, transparent: 0, kept: 0 };
  let output: Uint8Array;
  const before: string[] = [];
  try {
    const problem = checkPages(document.pages);
    if (problem) throw new ToolError(problem);
    for (let index = 0; index < document.pages; index++) {
      signal.throwIfAborted();
      const page = module.FPDF_LoadPage(document.handle, index);
      if (!page) throw new ToolError(MESSAGES.unreadable);
      try {
        before.push(pageText(module, page));
        if (await compressPage(module, document.handle, page, level, counts)) {
          if (!module.FPDFPage_GenerateContent(page)) throw new ToolError(MESSAGES.failed);
        }
      } finally {
        module.FPDF_ClosePage(page);
      }
      progress({ done: index + 1, total: document.pages });
    }
    if (counts.recompressed === 0) {
      return {
        blob: null,
        inputBytes: input.length,
        outputBytes: input.length,
        pages: document.pages,
        images: counts,
      };
    }
    output = save(module, document.handle);
  } finally {
    close(module, document);
  }
  signal.throwIfAborted();
  const after = textsOf(module, output);
  if (!after || !sameText(before, after)) throw new ToolError(MESSAGES.textChanged);
  const smaller = output.length < input.length;
  return {
    blob: smaller
      ? new Blob([output as Uint8Array<ArrayBuffer>], { type: "application/pdf" })
      : null,
    inputBytes: input.length,
    outputBytes: smaller ? output.length : input.length,
    pages: document.pages,
    images: counts,
  };
});
