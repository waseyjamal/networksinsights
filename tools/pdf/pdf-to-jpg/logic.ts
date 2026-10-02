// Pure logic of "PDF to JPG": the file rules, which pages are drawn, at what size and quality,
// with no DOM, no network and no top-level statements (docs/tool-contract.md, "logic.ts: what
// pure means"). worker.ts draws the pages with PDF.js (ADR 0057).

export const LIMITS = {
  /** 50 MB, one PDF at a time. */
  maxInputBytes: 50 * 1024 * 1024,
  maxFiles: 1,
} as const;

/** Pages drawn in one go: each picture is held in memory until it is downloaded. */
export const MAX_PAGES_PER_RUN = 50;

/**
 * The longest side of a picture, in pixels. 4,096 by 4,096 is 16,777,216 pixels, the largest
 * canvas Safari on iPhone and iPad allows, so a page drawn here never passes that.
 */
export const MAX_SIDE = 4096;

/** PDF sizes are in points, 72 to the inch. */
export const POINTS_PER_INCH = 72;

/** PDF.js's data files, served from this site (ADR 0057). Keep the version in step with pdfjs-dist. */
export const PDFJS_ASSETS = "/vendor/pdfjs/6.3.289/";

export const RESOLUTIONS = {
  "96": "Screen (96 dpi)",
  "150": "Standard (150 dpi)",
  "300": "Print (300 dpi)",
} as const;

export type Resolution = keyof typeof RESOLUTIONS;

export const QUALITIES = {
  high: { label: "High (92%)", value: 0.92 },
  balanced: { label: "Balanced (80%)", value: 0.8 },
  small: { label: "Smallest (60%)", value: 0.6 },
} as const;

export type Quality = keyof typeof QUALITIES;

export type Which = "all" | "chosen";

/** Kept for the manifest's input schema. */
export interface Input {
  which: Which;
  pages: string;
  resolution: Resolution;
  quality: Quality;
}

/** What the page sends the worker: count the pages, or draw some of them. */
export type Job =
  | { kind: "count"; file: Blob }
  | { kind: "render"; file: Blob; pages: number[]; resolution: Resolution; quality: Quality };

export interface Picture {
  page: number;
  blob: Blob;
  width: number;
  height: number;
}

export type JobResult = { kind: "count"; pages: number } | { kind: "render"; pictures: Picture[] };

export const MESSAGES = {
  notAPdf: "This file is not a PDF.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  encrypted:
    "This PDF is protected with a password. Remove the password in the program that made it, then try again.",
  unreadable: "This PDF could not be read. It may be damaged or not a real PDF.",
  noPages: "This PDF has no pages.",
  emptyPages: "Type the pages to turn into pictures, such as 1, 3-4.",
  badPart: (part: string) => `"${part}" is not a page or a range. Write pages like 4 or 2-6.`,
  backwards: (part: string) => `"${part}" runs backwards. Write the smaller page first.`,
  outside: (page: number, pages: number) =>
    `Page ${page} does not exist: this PDF has ${pages} ${pages === 1 ? "page" : "pages"}.`,
  tooManyPages: (count: number) =>
    `That is ${count} pages. Up to ${MAX_PAGES_PER_RUN} pages can be turned into pictures at a time: choose fewer, then run again for the rest.`,
  failed: "The pages could not be turned into pictures.",
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

/** The pages to draw, sorted and each once, from text such as `1, 3-4, 7-`. */
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

/** The pages for a run: all, or the chosen ones, and never more than the per-run limit. */
export function pagesForRun(
  which: Which,
  text: string,
  pages: number,
): { ok: true; pages: number[] } | { ok: false; error: string } {
  const chosen =
    which === "all"
      ? { ok: true as const, pages: Array.from({ length: pages }, (_, index) => index + 1) }
      : parsePages(text, pages);
  if (!chosen.ok) return chosen;
  if (chosen.pages.length > MAX_PAGES_PER_RUN) {
    return { ok: false, error: MESSAGES.tooManyPages(chosen.pages.length) };
  }
  return chosen;
}

/**
 * The drawing scale for a page of `width` by `height` points: the resolution asked for, lowered
 * when the longer side would pass 4,096 pixels.
 */
export function renderScale(width: number, height: number, resolution: Resolution): number {
  const wanted = Number(resolution) / POINTS_PER_INCH;
  const longest = Math.max(width, height);
  if (longest <= 0) return wanted;
  return Math.min(wanted, MAX_SIDE / longest);
}

/** The picture size for a scale: whole pixels, at least 1, at most 4,096 a side. */
export function pictureSize(width: number, height: number, scale: number) {
  const fit = (value: number) => Math.min(MAX_SIDE, Math.max(1, Math.floor(value * scale)));
  return { width: fit(width), height: fit(height) };
}

/** `report.pdf`, page 3, is `report-page-3.jpg`. */
export function pictureName(inputName: string, page: number): string {
  const base = inputName.replace(/\.pdf$/i, "").trim() || "document";
  return `${base}-page-${page}.jpg`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
