// Pure logic of "Redact PDF": the file rules, the boxes the visitor draws, the size each redacted
// page is drawn at and the name of the result, with no DOM, no network and no top-level statements
// (docs/tool-contract.md). worker.ts draws pages with PDF.js and builds the new PDF with pdf-lib
// (ADR 0057).

export const LIMITS = {
  /** 50 MB, one PDF at a time. */
  maxInputBytes: 50 * 1024 * 1024,
  maxFiles: 1,
  /** Pages in the PDF: our own choice, as each redacted page is held as a picture in memory. */
  maxPages: 100,
  /** Boxes on one page: our own choice. */
  maxBoxesPerPage: 50,
} as const;

/** PDF.js's data files, served from this site (ADR 0057). Keep the version in step with pdfjs-dist. */
export const PDFJS_ASSETS = "/vendor/pdfjs/6.3.289/";

/** A redacted page is drawn at 150 dpi... */
export const REDACT_DPI = 150;
/** ...but never more than 4,096 pixels on its longer side, the largest canvas some phones allow. */
export const MAX_SIDE = 4096;
/** The preview on the page is at most this many pixels on its longer side. */
export const PREVIEW_MAX_SIDE = 1200;
/** Redacted pages are saved as JPG at this quality: our own choice. */
export const QUALITY = 0.92;
/** The smallest box, as a fraction of the page: smaller drags are taken as a click. */
export const MIN_BOX = 0.005;

/** A black box, as fractions of the page as it is seen (0 to 1 from the top left). */
export interface Box {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Kept for the manifest's input schema. */
export interface Input {
  boxes: Omit<Box, "id">[];
}

export interface PageView {
  page: number;
  blob: Blob;
  /** The page as it is seen, in points (turned when the page is turned). */
  seenWidth: number;
  seenHeight: number;
}

export type Job =
  | { kind: "open"; file: Blob }
  | { kind: "render"; page: number }
  | { kind: "redact"; file: Blob; boxes: Box[] };

export type JobResult =
  | { kind: "open"; pages: number }
  | { kind: "render"; view: PageView }
  | { kind: "redact"; blob: Blob; redacted: number[]; pages: number };

export const MESSAGES = {
  notPdf: "This file is not a PDF.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooManyPages: (count: number) =>
    `This PDF has ${count} pages. Redact PDF opens PDFs of up to ${LIMITS.maxPages} pages: split it first.`,
  encrypted:
    "This PDF is protected with a password or encryption. Remove the protection first, then try again.",
  unreadable: "This PDF could not be read. It may be damaged or not a real PDF.",
  noPages: "This PDF has no pages.",
  noBoxes: "Draw at least one box over what you want to hide.",
  tooManyBoxes: `A page can have up to ${LIMITS.maxBoxesPerPage} boxes.`,
  renderFailed: "This page could not be drawn.",
  failed: "The redacted PDF could not be made.",
} as const;

export function isPdf(file: { name: string; type: string }): boolean {
  if (file.type === "application/pdf") return true;
  return file.type === "" && /\.pdf$/i.test(file.name);
}

export function checkFile(file: { name: string; type: string; size: number }): string | null {
  if (!isPdf(file)) return MESSAGES.notPdf;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return null;
}

export function checkPages(count: number): string | null {
  if (count === 0) return MESSAGES.noPages;
  if (count > LIMITS.maxPages) return MESSAGES.tooManyPages(count);
  return null;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** A box from two corners of a drag, kept on the page; null when it is too small to be meant. */
export function boxFrom(
  id: string,
  page: number,
  points: ReadonlyArray<{ x: number; y: number }>,
): Box | null {
  if (points.length < 2) return null;
  const xs = points.map((point) => clamp(point.x));
  const ys = points.map((point) => clamp(point.y));
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  if (width < MIN_BOX || height < MIN_BOX) return null;
  return { id, page, x, y, width, height };
}

/** A box moved to a new top left corner, still wholly on the page. */
export function moveBox(box: Box, x: number, y: number): Box {
  return {
    ...box,
    x: Math.min(1 - box.width, Math.max(0, x)),
    y: Math.min(1 - box.height, Math.max(0, y)),
  };
}

/** The pages that have at least one box, in order. */
export function redactedPages(boxes: readonly Box[]): number[] {
  return [...new Set(boxes.map((box) => box.page))].sort((a, b) => a - b);
}

/** The first problem with the boxes, or null. */
export function checkBoxes(boxes: readonly Box[]): string | null {
  if (boxes.length === 0) return MESSAGES.noBoxes;
  const counts = new Map<number, number>();
  for (const box of boxes) counts.set(box.page, (counts.get(box.page) ?? 0) + 1);
  for (const count of counts.values())
    if (count > LIMITS.maxBoxesPerPage) return MESSAGES.tooManyBoxes;
  return null;
}

/** The pixel size a page is drawn at, from its size in points: 150 dpi, at most 4,096 a side. */
export function renderSize(
  width: number,
  height: number,
  maxSide: number,
  dpi: number,
): { width: number; height: number } {
  const scale = Math.min(dpi / 72, maxSide / Math.max(width, height));
  const fit = (value: number) => Math.min(maxSide, Math.max(1, Math.round(value * scale)));
  return { width: fit(width), height: fit(height) };
}

/** A box in pixels on a drawn page, grown to whole pixels so no edge is left half covered. */
export function boxPixels(box: Box, width: number, height: number) {
  const left = Math.floor(box.x * width);
  const top = Math.floor(box.y * height);
  const right = Math.ceil((box.x + box.width) * width);
  const bottom = Math.ceil((box.y + box.height) * height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** `contract.pdf` becomes `contract-redacted.pdf`. */
export function outputName(inputName: string): string {
  const base = inputName.replace(/\.pdf$/i, "").trim() || "document";
  return `${base}-redacted.pdf`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
