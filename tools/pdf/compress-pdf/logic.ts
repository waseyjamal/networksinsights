// Pure logic of "Compress PDF": the file rules, the levels, which pictures are worth recompressing
// and at what size, the pixel conversion, and how the result is described. No DOM, no network and
// no top-level statements (docs/tool-contract.md, "logic.ts: what pure means"). worker.ts does the
// work with PDFium compiled to WebAssembly (@embedpdf/pdfium, ADR 0062): it recompresses the
// pictures as JPEG and leaves the text, fonts and drawings as they are.

export const LIMITS = {
  /** 50 MB, one PDF at a time. */
  maxInputBytes: 50 * 1024 * 1024,
  maxFiles: 1,
  /** More pages than this is refused before any work, to keep a phone responsive. */
  maxPages: 500,
  /** A picture larger than this many pixels is left as it is: decoding it takes too much memory. */
  maxImagePixels: 25_000_000,
} as const;

/** How hard to compress: the resolution pictures are brought down to, and the JPEG quality. */
export const LEVELS = {
  light: { label: "Light: 220 dpi, high quality", dpi: 220, quality: 0.85 },
  recommended: { label: "Recommended: 150 dpi, good quality", dpi: 150, quality: 0.75 },
  strong: { label: "Strong: 96 dpi, smaller pictures", dpi: 96, quality: 0.6 },
} as const;

export type Level = keyof typeof LEVELS;

export const LEVEL_KEYS = Object.keys(LEVELS) as Level[];

/** A picture is replaced only when its new JPEG is at most this share of the bytes it had. */
export const KEEP_RATIO = 0.9;

/** Kept for the manifest's input schema. */
export interface Input {
  level: Level;
}

/** What the page sends the worker. */
export interface Job {
  file: Blob;
  level: Level;
}

/** What happened to the pictures. */
export interface ImageCounts {
  /** Pictures found on the pages. */
  found: number;
  /** Pictures recompressed. */
  recompressed: number;
  /** Pictures with transparency or a mask, left as they were. */
  transparent: number;
  /** Pictures left as they were for any other reason: too large, unusual colours, no gain. */
  kept: number;
}

/** What the worker sends back. `blob` is null when the PDF would not get smaller. */
export interface JobResult {
  blob: Blob | null;
  inputBytes: number;
  outputBytes: number;
  pages: number;
  images: ImageCounts;
}

export const MESSAGES = {
  notAPdf: "This file is not a PDF.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooManyPages: (pages: number, limit: number) =>
    `This PDF has ${pages} pages. Compress PDF works on up to ${limit} pages.`,
  encrypted:
    "This PDF is protected with a password. Remove the password in the program that made it, then try again.",
  unreadable: "This PDF could not be read. It may be damaged or not a real PDF.",
  noPages: "This PDF has no pages.",
  textChanged:
    "This PDF could not be compressed without changing its text, so nothing was changed. Your original file is unchanged.",
  failed: "The PDF could not be compressed. Your original file is unchanged.",
  notSmaller:
    "This PDF did not get smaller, so there is nothing to download: keep your original. Its pictures may already be compressed, or most of its size is text, fonts or drawings.",
} as const;

export function isPdf(file: { name: string; type: string }): boolean {
  if (file.type === "application/pdf") return true;
  return file.type === "" && /\.pdf$/i.test(file.name);
}

export function checkFile(file: { name: string; type: string; size: number }): string | undefined {
  if (!isPdf(file)) return MESSAGES.notAPdf;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return;
}

/** The page count problem, if any. */
export function checkPages(pages: number): string | undefined {
  if (pages < 1) return MESSAGES.noPages;
  if (pages > LIMITS.maxPages) return MESSAGES.tooManyPages(pages, LIMITS.maxPages);
  return;
}

/**
 * The pixel size a picture is brought down to, from its pixel size and the resolution it is
 * shown at on the page (dots per inch). A picture already at or below the target keeps its size.
 */
export function targetSize(
  width: number,
  height: number,
  shownDpi: number,
  targetDpi: number,
): { width: number; height: number } {
  if (!(shownDpi > targetDpi)) return { width, height };
  const scale = targetDpi / shownDpi;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** PDFium's colour spaces whose pictures can become an RGB or grey JPEG without a colour shift. */
const SAFE_COLOR_SPACES = new Set([
  1, // DeviceGray
  2, // DeviceRGB
  4, // CalGray
  5, // CalRGB
  7, // ICCBased (one or three components; four-component profiles have 32 bits a pixel)
  10, // Indexed
]);

/** Why a picture is left as it is, or null when it can be recompressed. */
export function skipReason(image: {
  width: number;
  height: number;
  bitsPerPixel: number;
  colorSpace: number;
}): "large" | "format" | null {
  if (image.width * image.height > LIMITS.maxImagePixels) return "large";
  if (image.bitsPerPixel !== 8 && image.bitsPerPixel !== 24) return "format";
  if (!SAFE_COLOR_SPACES.has(image.colorSpace)) return "format";
  return null;
}

/** Whether a new JPEG of `jpegBytes` should replace a picture stored in `originalBytes`. */
export function worthReplacing(jpegBytes: number, originalBytes: number): boolean {
  return jpegBytes > 0 && jpegBytes <= originalBytes * KEEP_RATIO;
}

/** PDFium bitmap formats: grey (1 byte), BGR (3), BGRx (4) and BGRA (4) a pixel. */
export const BITMAP_FORMATS = { gray: 1, bgr: 2, bgrx: 3, bgra: 4 } as const;

/**
 * Copies a PDFium bitmap (rows of `stride` bytes, grey, BGR or BGRx) into opaque RGBA pixels for
 * a canvas. Returns null for a format it does not read.
 */
export function toRgba(
  source: Uint8Array,
  width: number,
  height: number,
  stride: number,
  format: number,
): Uint8ClampedArray<ArrayBuffer> | null {
  const bytes =
    format === BITMAP_FORMATS.gray
      ? 1
      : format === BITMAP_FORMATS.bgr
        ? 3
        : format === BITMAP_FORMATS.bgrx
          ? 4
          : 0;
  if (bytes === 0) return null;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    let from = y * stride;
    let to = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (bytes === 1) {
        const grey = source[from] ?? 0;
        pixels[to] = grey;
        pixels[to + 1] = grey;
        pixels[to + 2] = grey;
      } else {
        pixels[to] = source[from + 2] ?? 0;
        pixels[to + 1] = source[from + 1] ?? 0;
        pixels[to + 2] = source[from] ?? 0;
      }
      pixels[to + 3] = 255;
      from += bytes;
      to += 4;
    }
  }
  return pixels;
}

/** Whether any pixel of a BGRA bitmap is not fully opaque. */
export function hasTransparency(
  source: Uint8Array,
  width: number,
  height: number,
  stride: number,
): boolean {
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      if (source[row + x * 4 + 3] !== 255) return true;
    }
  }
  return false;
}

/** Whether two lists of page texts say the same, ignoring how spaces and line breaks fall. */
export function sameText(before: readonly string[], after: readonly string[]): boolean {
  if (before.length !== after.length) return false;
  const flat = (text: string) => text.replace(/\s+/g, "");
  return before.every((text, index) => flat(text) === flat(after[index] ?? ""));
}

/** `scan.pdf` becomes `scan-compressed.pdf`. */
export function outputName(inputName: string): string {
  const base = inputName.replace(/\.pdf$/i, "").trim() || "document";
  return `${base}-compressed.pdf`;
}

/** "62% smaller", from the sizes before and after. Rounded down, so it never overstates. */
export function savingLabel(before: number, after: number): string {
  if (before <= 0 || after >= before) return "not smaller";
  const percent = Math.floor(((before - after) / before) * 100);
  return percent < 1 ? "less than 1% smaller" : `${percent}% smaller`;
}

export function pagesLabel(count: number): string {
  return `${count} ${count === 1 ? "page" : "pages"}`;
}

export function picturesLabel(count: number): string {
  return `${count} ${count === 1 ? "picture" : "pictures"}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
