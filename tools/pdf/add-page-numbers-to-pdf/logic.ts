// Pure logic of "Add Page Numbers to PDF": the file rules, the settings, which pages get which
// number, the text of each number and where it sits on the page, rotated pages included, with no
// DOM, no network and no top-level statements (docs/tool-contract.md, "logic.ts: what pure
// means"). worker.ts opens the PDF and draws the numbers with pdf-lib (ADR 0057).

export const LIMITS = {
  /** 50 MB, one PDF at a time. */
  maxInputBytes: 50 * 1024 * 1024,
  maxFiles: 1,
} as const;

/** Font size in points: 6 to 72. Our own choice of a readable range. */
export const FONT_SIZE = { min: 6, max: 72, initial: 11 } as const;

/** Distance from the page edge in points (72 points are one inch): 0 to 144, two inches. */
export const MARGIN = { min: 0, max: 144, initial: 36 } as const;

/** The first number: 0 to 99,999. */
export const START = { min: 0, max: 99_999 } as const;

export const POSITIONS = {
  "bottom-center": "Bottom centre",
  "bottom-right": "Bottom right",
  "bottom-left": "Bottom left",
  "top-center": "Top centre",
  "top-right": "Top right",
  "top-left": "Top left",
} as const;

export type Position = keyof typeof POSITIONS;

export const FORMATS = {
  number: "1",
  page: "Page 1",
  of: "1 of N",
} as const;

export type Format = keyof typeof FORMATS;

export type Which = "all" | "chosen";

/** Kept for the manifest's input schema. */
export interface Input {
  position: Position;
  format: Format;
  start: number;
  firstPage: number;
  fontSize: number;
  margin: number;
  which: Which;
  pages: string;
}

/** One number to draw: on which page (from 1), and its text. */
export interface Stamp {
  page: number;
  text: string;
}

/** What the page sends the worker: count the pages, or draw the numbers. */
export type Job =
  | { kind: "count"; file: Blob }
  | {
      kind: "number";
      file: Blob;
      stamps: Stamp[];
      position: Position;
      fontSize: number;
      margin: number;
    };

/** What the worker sends back. */
export type JobResult = { kind: "count"; pages: number } | { kind: "number"; blob: Blob };

export const MESSAGES = {
  notAPdf: "This file is not a PDF.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  encrypted:
    "This PDF is protected with a password. Remove the password in the program that made it, then try again.",
  unreadable: "This PDF could not be read. It may be damaged or not a real PDF.",
  noPages: "This PDF has no pages.",
  emptyPages: "Type the pages to number, such as 1, 3-4.",
  badPart: (part: string) => `"${part}" is not a page or a range. Write pages like 4 or 2-6.`,
  backwards: (part: string) => `"${part}" runs backwards. Write the smaller page first.`,
  outside: (page: number, pages: number) =>
    `Page ${page} does not exist: this PDF has ${pages} ${pages === 1 ? "page" : "pages"}.`,
  start: `The start number must be a whole number from ${START.min} to ${START.max.toLocaleString("en-US")}.`,
  firstPage: (pages: number) =>
    `The first page to number must be a whole number from 1 to ${pages}.`,
  fontSize: `The font size must be a whole number from ${FONT_SIZE.min} to ${FONT_SIZE.max} points.`,
  margin: `The margin must be a whole number from ${MARGIN.min} to ${MARGIN.max} points.`,
  nothing: "No page gets a number: every chosen page comes before the first page to number.",
  failed: "The page numbers could not be added.",
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

/** A whole number from text, or undefined. Spaces and thousands commas are allowed. */
export function parseWhole(text: string): number | undefined {
  const cleaned = text.replace(/[\s,]/g, "");
  if (!/^\d+$/.test(cleaned)) return;
  const value = Number(cleaned);
  if (!Number.isSafeInteger(value)) return;
  return value;
}

/**
 * The pages chosen, counted from 1 and sorted, from text such as `1, 3-4, 7-`. A page named twice
 * counts once. `7-` runs to the last page.
 */
export function parsePages(
  text: string,
  pages: number,
): { ok: true; pages: number[] } | { ok: false; error: string } {
  const parts = text
    .split(/[,;]/)
    .map((part) => part.replace(/\s+/g, "").replace(/[–—]/g, "-"))
    .filter((part) => part !== "");
  if (parts.length === 0) return { ok: false, error: MESSAGES.emptyPages };
  const chosen = new Set<number>();
  for (const part of parts) {
    const match = /^(\d+)(?:-(\d*))?$/.exec(part);
    if (!match) return { ok: false, error: MESSAGES.badPart(part) };
    const from = Number(match[1]);
    const to = match[2] === "" ? pages : Number(match[2] ?? from);
    if (from < 1) return { ok: false, error: MESSAGES.badPart(part) };
    if (to < from) return { ok: false, error: MESSAGES.backwards(part) };
    if (from > pages) return { ok: false, error: MESSAGES.outside(from, pages) };
    if (to > pages) return { ok: false, error: MESSAGES.outside(to, pages) };
    for (let page = from; page <= to; page++) chosen.add(page);
  }
  return { ok: true, pages: [...chosen].sort((a, b) => a - b) };
}

export interface Settings {
  format: Format;
  start: string;
  firstPage: string;
  fontSize: string;
  margin: string;
  which: Which;
  pages: string;
}

/** The text of one number. `total` is the number the last page of the PDF would carry. */
export function numberText(format: Format, value: number, total: number): string {
  if (format === "page") return `Page ${value}`;
  if (format === "of") return `${value} of ${total}`;
  return String(value);
}

/**
 * Every number to draw. Page `firstPage` carries `start`, and each later page one more; pages
 * before it carry none. Of those, only the chosen pages get their number drawn, so a page left out
 * still counts. In "1 of N", N is the number the last page of the PDF would carry.
 */
export function planStamps(
  settings: Settings,
  pages: number,
): { ok: true; stamps: Stamp[]; fontSize: number; margin: number } | { ok: false; error: string } {
  const start = parseWhole(settings.start);
  if (typeof start === "undefined" || start < START.min || start > START.max) {
    return { ok: false, error: MESSAGES.start };
  }
  const firstPage = parseWhole(settings.firstPage);
  if (typeof firstPage === "undefined" || firstPage < 1 || firstPage > pages) {
    return { ok: false, error: MESSAGES.firstPage(pages) };
  }
  const fontSize = parseWhole(settings.fontSize);
  if (typeof fontSize === "undefined" || fontSize < FONT_SIZE.min || fontSize > FONT_SIZE.max) {
    return { ok: false, error: MESSAGES.fontSize };
  }
  const margin = parseWhole(settings.margin);
  if (typeof margin === "undefined" || margin < MARGIN.min || margin > MARGIN.max) {
    return { ok: false, error: MESSAGES.margin };
  }
  let chosen: number[];
  if (settings.which === "chosen") {
    const parsed = parsePages(settings.pages, pages);
    if (!parsed.ok) return parsed;
    chosen = parsed.pages;
  } else {
    chosen = Array.from({ length: pages }, (_, index) => index + 1);
  }
  const total = start + (pages - firstPage);
  const stamps = chosen
    .filter((page) => page >= firstPage)
    .map((page) => ({
      page,
      text: numberText(settings.format, start + (page - firstPage), total),
    }));
  if (stamps.length === 0) return { ok: false, error: MESSAGES.nothing };
  return { ok: true, stamps, fontSize, margin };
}

/** A page's box in PDF points, and how it is shown: turned 0, 90, 180 or 270 degrees clockwise. */
export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** Where pdf-lib draws the text: the start of its baseline, and its angle counterclockwise. */
export interface Placement {
  x: number;
  y: number;
  rotate: number;
}

/** Normalises any multiple of 90 to 0, 90, 180 or 270. */
export function normalRotation(angle: number): number {
  const quarter = Math.round(angle / 90) * 90;
  return ((quarter % 360) + 360) % 360;
}

/**
 * Where a number goes, so it reads upright at the chosen corner or edge of the page as it is
 * shown, even when the page is turned. The position is worked out on the page as seen, then
 * mapped back into the page's own coordinates.
 */
export function placeText(
  box: PageBox,
  position: Position,
  textWidth: number,
  fontSize: number,
  margin: number,
): Placement {
  const rotation = normalRotation(box.rotation);
  const sideways = rotation === 90 || rotation === 270;
  const seenWidth = sideways ? box.height : box.width;
  const seenHeight = sideways ? box.width : box.height;
  const [vertical, horizontal] = position.split("-") as ["top" | "bottom", string];
  let u: number;
  if (horizontal === "left") u = margin;
  else if (horizontal === "right") u = seenWidth - margin - textWidth;
  else u = (seenWidth - textWidth) / 2;
  // A baseline at the margin for the bottom; for the top, the cap height (about 0.72 of the size
  // in Helvetica) ends at the margin.
  const v = vertical === "bottom" ? margin : seenHeight - margin - fontSize * 0.72;
  const { x, y, width, height } = box;
  if (rotation === 90) return { x: x + width - v, y: y + u, rotate: 90 };
  if (rotation === 180) return { x: x + width - u, y: y + height - v, rotate: 180 };
  if (rotation === 270) return { x: x + v, y: y + height - u, rotate: 270 };
  return { x: x + u, y: y + v, rotate: 0 };
}

/** `report.pdf` becomes `report-numbered.pdf`. */
export function outputName(inputName: string): string {
  const base = inputName.replace(/\.pdf$/i, "").trim() || "document";
  return `${base}-numbered.pdf`;
}

export function pagesLabel(count: number): string {
  return `${count} ${count === 1 ? "page" : "pages"}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
