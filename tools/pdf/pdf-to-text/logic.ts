// Pure logic of "PDF to Text": the file rules, which pages are read, how the pieces PDF.js finds
// on a page are joined into lines, and the .txt that comes out, with no DOM, no network and no
// top-level statements (docs/tool-contract.md). worker.ts reads the PDF with PDF.js (ADR 0057).

export const LIMITS = {
  /** 50 MB, one PDF at a time. */
  maxInputBytes: 50 * 1024 * 1024,
  maxFiles: 1,
} as const;

/** PDF.js's data files, served from this site (ADR 0057). Keep the version in step with pdfjs-dist. */
export const PDFJS_ASSETS = "/vendor/pdfjs/6.3.289/";

export type Which = "all" | "chosen";

/** Kept for the manifest's input schema. */
export interface Input {
  which: Which;
  pages: string;
  markPages: boolean;
}

/** One piece of text as PDF.js gives it: its string, and whether a line ends after it. */
export interface Piece {
  str: string;
  hasEOL: boolean;
}

export interface PageText {
  page: number;
  text: string;
}

/** What the page sends the worker: count the pages, or read the text of some of them. */
export type Job = { kind: "count"; file: Blob } | { kind: "read"; file: Blob; pages: number[] };

export type JobResult = { kind: "count"; pages: number } | { kind: "read"; pages: PageText[] };

export const MESSAGES = {
  notAPdf: "This file is not a PDF.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  encrypted: "This PDF is protected with a password. Remove the password first, then try again.",
  unreadable: "This PDF could not be read. It may be damaged or not a real PDF.",
  noPages: "This PDF has no pages.",
  emptyPages: "Type the pages to read, such as 1, 3-4.",
  badPart: (part: string) => `"${part}" is not a page or a range. Write pages like 4 or 2-6.`,
  backwards: (part: string) => `"${part}" runs backwards. Write the smaller page first.`,
  outside: (page: number, pages: number) =>
    `Page ${page} does not exist: this PDF has ${pages} ${pages === 1 ? "page" : "pages"}.`,
  noText:
    "No text was found on these pages. The PDF is probably scanned: its pages are pictures of text. Use the OCR tool to read text from a picture.",
  failed: "The text could not be read from this PDF.",
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

/** The pages to read, sorted and each once, from text such as `1, 3-4, 7-`. */
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

export function pagesForRun(
  which: Which,
  text: string,
  pages: number,
): { ok: true; pages: number[] } | { ok: false; error: string } {
  if (which === "all") {
    return { ok: true, pages: Array.from({ length: pages }, (_, index) => index + 1) };
  }
  return parsePages(text, pages);
}

/**
 * One page's text from PDF.js's pieces: pieces are joined as they come, a line ends where PDF.js
 * says one ends, spaces at line ends are dropped and runs of blank lines become one.
 */
export function joinPieces(pieces: readonly Piece[]): string {
  let text = "";
  for (const piece of pieces) {
    text += piece.str;
    if (piece.hasEOL) text += "\n";
  }
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when no page holds a single letter, digit or sign: a scanned PDF, most likely. */
export function hasNoText(pages: readonly PageText[]): boolean {
  return pages.every((page) => page.text.trim() === "");
}

/** The pages with no text at all, for a note under the result. */
export function emptyPages(pages: readonly PageText[]): number[] {
  return pages.filter((page) => page.text.trim() === "").map((page) => page.page);
}

/** The whole .txt: pages in order, a blank line between them, and a page line when asked. */
export function toText(pages: readonly PageText[], markPages: boolean): string {
  const parts = pages.map((page) =>
    markPages ? `--- Page ${page.page} ---\n${page.text}`.trimEnd() : page.text,
  );
  const joined = (markPages ? parts : parts.filter((part) => part !== "")).join("\n\n");
  return joined === "" ? "" : `${joined}\n`;
}

export function countWords(text: string): number {
  const words = text.trim().split(/\s+/);
  return words[0] === "" ? 0 : words.length;
}

/** `report.pdf` becomes `report.txt`. */
export function textName(inputName: string): string {
  const base = inputName.replace(/\.pdf$/i, "").trim() || "document";
  return `${base}.txt`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
