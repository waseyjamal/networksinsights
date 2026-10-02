// Pure logic of "Split PDF": the file rules and the page ranges, with no DOM, no network and no
// top-level statements (docs/tool-contract.md, "logic.ts: what pure means"). worker.ts reads the
// PDF and writes the parts with pdf-lib (ADR 0057).

export const LIMITS = {
  /** 50 MB, one PDF at a time. */
  maxInputBytes: 50 * 1024 * 1024,
  maxFiles: 1,
} as const;

/** A run of pages, both ends included, counted from 1. */
export interface Range {
  from: number;
  to: number;
}

export type Mode = "ranges" | "every";

/** Kept for the manifest's input schema. */
export interface Input {
  mode: Mode;
  ranges: string;
}

/** What the page sends the worker: count the pages, or write the parts. */
export type Job = { kind: "count"; file: Blob } | { kind: "split"; file: Blob; ranges: Range[] };

/** What the worker sends back. */
export type JobResult =
  | { kind: "count"; pages: number }
  | { kind: "split"; parts: Array<{ range: Range; blob: Blob }> };

export const MESSAGES = {
  notAPdf: "This file is not a PDF.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  encrypted:
    "This PDF is protected with a password. Remove the password in the program that made it, then try again.",
  unreadable: "This PDF could not be read. It may be damaged or not a real PDF.",
  noPages: "This PDF has no pages.",
  emptyRanges: "Type the pages to keep, such as 1-3, 5.",
  badPart: (part: string) => `"${part}" is not a page or a range. Write pages like 4 or 2-6.`,
  backwards: (part: string) => `"${part}" runs backwards. Write the smaller page first.`,
  outside: (page: number, pages: number) =>
    `Page ${page} does not exist: this PDF has ${pages} ${pages === 1 ? "page" : "pages"}.`,
  failed: "The PDF could not be split.",
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

/**
 * Reads ranges such as `1-3, 5, 8-10` against a PDF of `pages` pages. Each comma-separated part
 * is one range; a single page is a range of one. `8-` runs to the last page. Spaces are ignored,
 * and an en dash works as a hyphen.
 */
export function parseRanges(
  text: string,
  pages: number,
): { ok: true; ranges: Range[] } | { ok: false; error: string } {
  const parts = text
    .split(/[,;]/)
    .map((part) => part.replace(/\s+/g, "").replace(/[–—]/g, "-"))
    .filter((part) => part !== "");
  if (parts.length === 0) return { ok: false, error: MESSAGES.emptyRanges };
  const ranges: Range[] = [];
  for (const part of parts) {
    const match = /^(\d+)(?:-(\d*))?$/.exec(part);
    if (!match) return { ok: false, error: MESSAGES.badPart(part) };
    const from = Number(match[1]);
    // No hyphen: one page. A hyphen with nothing after it: to the last page.
    const end = match[2] === "" ? pages : Number(match[2] ?? from);
    if (from < 1) return { ok: false, error: MESSAGES.badPart(part) };
    if (end < from) return { ok: false, error: MESSAGES.backwards(part) };
    if (from > pages) return { ok: false, error: MESSAGES.outside(from, pages) };
    if (end > pages) return { ok: false, error: MESSAGES.outside(end, pages) };
    ranges.push({ from, to: end });
  }
  return { ok: true, ranges };
}

/** One range a page: what "every page" means. */
export function everyPage(pages: number): Range[] {
  return Array.from({ length: pages }, (_, index) => ({ from: index + 1, to: index + 1 }));
}

/** The zero-based page indices of a range, as pdf-lib counts them. */
export function indicesOf(range: Range): number[] {
  return Array.from({ length: range.to - range.from + 1 }, (_, index) => range.from - 1 + index);
}

/** `report.pdf`, pages 2 to 4, is `report-pages-2-4.pdf`; page 5 alone is `report-page-5.pdf`. */
export function partName(inputName: string, range: Range): string {
  const base = inputName.replace(/\.pdf$/i, "").trim() || "document";
  return range.from === range.to
    ? `${base}-page-${range.from}.pdf`
    : `${base}-pages-${range.from}-${range.to}.pdf`;
}

export function rangeLabel(range: Range): string {
  return range.from === range.to ? `Page ${range.from}` : `Pages ${range.from} to ${range.to}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
