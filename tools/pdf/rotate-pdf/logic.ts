// Pure logic of "Rotate PDF": the file rules, which pages turn and by how much, with no DOM, no
// network and no top-level statements (docs/tool-contract.md, "logic.ts: what pure means").
// worker.ts opens the PDF with pdf-lib and sets each page's rotation (ADR 0057).

export const LIMITS = {
  /** 50 MB, one PDF at a time. */
  maxInputBytes: 50 * 1024 * 1024,
  maxFiles: 1,
} as const;

/** Clockwise turns offered, in degrees. 270 is a quarter turn counterclockwise. */
export const TURNS = {
  "90": "90° clockwise",
  "180": "180° (upside down)",
  "270": "90° counterclockwise",
} as const;

export type Turn = keyof typeof TURNS;

export type Which = "all" | "chosen";

/** Kept for the manifest's input schema. */
export interface Input {
  turn: Turn;
  which: Which;
  pages: string;
}

/** What the page sends the worker: count the pages, or turn some of them. */
export type Job =
  | { kind: "count"; file: Blob }
  | { kind: "rotate"; file: Blob; pages: number[]; turn: Turn };

/** What the worker sends back. */
export type JobResult = { kind: "count"; pages: number } | { kind: "rotate"; blob: Blob };

export const MESSAGES = {
  notAPdf: "This file is not a PDF.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  encrypted:
    "This PDF is protected with a password. Remove the password in the program that made it, then try again.",
  unreadable: "This PDF could not be read. It may be damaged or not a real PDF.",
  noPages: "This PDF has no pages.",
  emptyPages: "Type the pages to turn, such as 1, 3-4.",
  badPart: (part: string) => `"${part}" is not a page or a range. Write pages like 4 or 2-6.`,
  backwards: (part: string) => `"${part}" runs backwards. Write the smaller page first.`,
  outside: (page: number, pages: number) =>
    `Page ${page} does not exist: this PDF has ${pages} ${pages === 1 ? "page" : "pages"}.`,
  failed: "The PDF could not be rotated.",
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
 * The pages to turn, counted from 1 and sorted, from text such as `1, 3-4, 7-`. A page named twice
 * is turned once. `7-` runs to the last page.
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

/** Every page, 1 to `pages`. */
export function allPages(pages: number): number[] {
  return Array.from({ length: pages }, (_, index) => index + 1);
}

/** A page's rotation after a turn: always 0, 90, 180 or 270. */
export function turned(current: number, turn: Turn): number {
  const next = (current + Number(turn)) % 360;
  return next < 0 ? next + 360 : next;
}

/** `scan.pdf` becomes `scan-rotated.pdf`. */
export function outputName(inputName: string): string {
  const base = inputName.replace(/\.pdf$/i, "").trim() || "document";
  return `${base}-rotated.pdf`;
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
