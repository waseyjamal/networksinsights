// Pure logic of "Delete and Reorder PDF Pages": the file rules, the page list the visitor edits
// (order and deletions) and the pages that end up in the new file, with no DOM, no network and no
// top-level statements (docs/tool-contract.md, "logic.ts: what pure means"). worker.ts draws the
// thumbnails with PDF.js and writes the new PDF with pdf-lib (ADR 0057).

export const LIMITS = {
  /** 50 MB, one PDF at a time. */
  maxInputBytes: 50 * 1024 * 1024,
  maxFiles: 1,
} as const;

/** The most pages a PDF may have here: every page gets a thumbnail held in memory. Our own choice. */
export const MAX_PAGES = 200;

/** The longest side of a thumbnail, in pixels. */
export const THUMB_SIDE = 160;

/** PDF.js's data files, served from this site (ADR 0057). Keep the version in step with pdfjs-dist. */
export const PDFJS_ASSETS = "/vendor/pdfjs/6.3.289/";

/** Kept for the manifest's input schema: the original page numbers to keep, in their new order. */
export interface Input {
  order: number[];
}

/** One page in the list the visitor edits. `page` is its number in the original PDF, from 1. */
export interface Item {
  page: number;
  deleted: boolean;
}

export interface Thumb {
  page: number;
  /** Null when this browser could not draw the page. */
  blob: Blob | null;
  width: number;
  height: number;
}

/** What the page sends the worker: open the PDF and draw thumbnails, or write the new PDF. */
export type Job = { kind: "open"; file: Blob } | { kind: "build"; file: Blob; order: number[] };

/** What the worker sends back. */
export type JobResult =
  | { kind: "open"; pages: number; thumbs: Thumb[] }
  | { kind: "build"; blob: Blob };

export const MESSAGES = {
  notAPdf: "This file is not a PDF.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooManyPages: (pages: number) =>
    `This PDF has ${pages} pages. This tool takes at most ${MAX_PAGES} pages; split it first.`,
  encrypted:
    "This PDF is protected with a password. Remove the password in the program that made it, then try again.",
  unreadable: "This PDF could not be read. It may be damaged or not a real PDF.",
  noPages: "This PDF has no pages.",
  allDeleted: "Every page is marked for deletion. Keep at least one page.",
  failed: "The new PDF could not be made.",
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

/** The page count rule, checked by the worker once the PDF is open. */
export function checkPageCount(pages: number): string | undefined {
  if (pages < 1) return MESSAGES.noPages;
  if (pages > MAX_PAGES) return MESSAGES.tooManyPages(pages);
  return;
}

/** Every page, in its original order, none deleted. */
export function initialItems(pages: number): Item[] {
  return Array.from({ length: pages }, (_, index) => ({ page: index + 1, deleted: false }));
}

/** The list with the item at `from` moved to position `to`. Positions outside the list are clamped. */
export function moveItem(items: Item[], from: number, to: number): Item[] {
  if (from < 0 || from >= items.length) return items;
  const target = Math.min(Math.max(to, 0), items.length - 1);
  if (target === from) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(target, 0, moved);
  return next;
}

/** The list with the item at `index` marked deleted, or kept again. */
export function toggleDeleted(items: Item[], index: number): Item[] {
  return items.map((item, at) => (at === index ? { ...item, deleted: !item.deleted } : item));
}

/** The original page numbers that go into the new PDF, in their new order. */
export function keptPages(items: Item[]): number[] {
  return items.filter((item) => !item.deleted).map((item) => item.page);
}

/** True when the list is still the original PDF: nothing deleted and nothing moved. */
export function isUnchanged(items: Item[]): boolean {
  return items.every((item, index) => !item.deleted && item.page === index + 1);
}

/** Checks the order the worker is given: original page numbers, each once, at least one. */
export function checkOrder(
  order: number[],
  pages: number,
): { ok: true } | { ok: false; error: string } {
  if (order.length === 0) return { ok: false, error: MESSAGES.allDeleted };
  const seen = new Set<number>();
  for (const page of order) {
    if (!Number.isInteger(page) || page < 1 || page > pages || seen.has(page)) {
      return { ok: false, error: MESSAGES.failed };
    }
    seen.add(page);
  }
  return { ok: true };
}

/** The scale that draws a page of this size with its longer side at THUMB_SIDE pixels. */
export function thumbScale(width: number, height: number): number {
  const longer = Math.max(width, height);
  return longer > 0 ? THUMB_SIDE / longer : 1;
}

/** A short summary of the result, such as "4 pages, 1 deleted, order changed". */
export function summary(items: Item[]): string {
  const kept = keptPages(items);
  const deleted = items.length - kept.length;
  const moved = kept.some((page, index) => index > 0 && page < (kept[index - 1] ?? 0));
  const parts = [pagesLabel(kept.length)];
  if (deleted > 0) parts.push(`${deleted} deleted`);
  if (moved) parts.push("order changed");
  return parts.join(", ");
}

/** `report.pdf` becomes `report-edited.pdf`. */
export function outputName(inputName: string): string {
  const base = inputName.replace(/\.pdf$/i, "").trim() || "document";
  return `${base}-edited.pdf`;
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
