// Pure logic of "OCR image to text": the file rules, the languages and their download sizes, the
// size pages and pictures are read at, and how the text of several pages is put together, with no
// DOM, no network and no top-level statements (docs/tool-contract.md, "logic.ts: what pure
// means"). worker.ts reads the text with Tesseract and draws PDF pages with PDF.js (ADR 0057,
// ADR 0060).

import { safeFilename } from "@networksinsights/tool-sdk/download";

/** The limits the manifest declares and the page enforces: one source for both. */
export const LIMITS = {
  /** 20 MB, one file at a time. */
  maxInputBytes: 20 * 1024 * 1024,
  maxFiles: 1,
} as const;

/** The most pages of one PDF read in a run: each page takes seconds, more on a phone. */
export const MAX_PAGES = 20;

/**
 * The longest side, in pixels, of what Tesseract reads. A larger photo is scaled down to it, and
 * a PDF page is drawn at 300 dpi up to it. It keeps memory in check on a phone.
 */
export const MAX_SIDE = 4000;

/** PDF pages are drawn at 300 dpi, the resolution Tesseract reads best; PDF sizes are in points. */
export const PDF_DPI = 300;
export const POINTS_PER_INCH = 72;

/** PDF.js's data files, served from this site (ADR 0057). Keep the version in step with pdfjs-dist. */
export const PDFJS_ASSETS = "/vendor/pdfjs/6.3.289/";

/** Tesseract's files, served from this site (ADR 0060). Keep the version in step with tesseract.js. */
export const TESSERACT_ASSETS = "/vendor/tesseract/7.0.0/";

/**
 * The languages offered, with the size in bytes of their data file as this site serves it (the
 * integer versions of tessdata_best, gzip). A test checks these against the installed files.
 */
export const LANGUAGES = {
  eng: { label: "English", bytes: 2_952_873 },
  hin: { label: "Hindi", bytes: 1_389_692 },
} as const;

export type Language = keyof typeof LANGUAGES;

/** The choices on the page, and the language files each one downloads. */
export const LANGUAGE_CHOICES = {
  eng: { label: "English", languages: ["eng"] },
  hin: { label: "Hindi", languages: ["hin"] },
  both: { label: "English and Hindi", languages: ["eng", "hin"] },
} as const satisfies Record<string, { label: string; languages: readonly Language[] }>;

export type LanguageChoice = keyof typeof LANGUAGE_CHOICES;

/**
 * The OCR engine as served, in bytes: the core of tesseract.js-core, its script and its
 * WebAssembly, the larger of the two builds (with SIMD), plus the tesseract.js worker script.
 * A test checks it against the installed files.
 */
export const ENGINE_BYTES = 88_977 + 3_451_410 + 111_307;

/** Kept for the manifest's input schema: the choice a visitor makes. */
export interface Input {
  language: LanguageChoice;
}

export type InputKind = "image" | "pdf";

/** What the page sends the worker. */
export interface Job {
  file: Blob;
  kind: InputKind;
  language: LanguageChoice;
}

export interface PageText {
  page: number;
  text: string;
}

export interface JobResult {
  pages: PageText[];
}

export const MESSAGES = {
  unsupported: "This file is not a PNG, JPG, WebP or PDF.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooManyPages: (pages: number) =>
    `This PDF has ${pages} pages. Up to ${MAX_PAGES} pages can be read at a time: split it first, for example with Split PDF.`,
  encrypted:
    "This PDF is protected with a password. Remove the password in the program that made it, then try again.",
  unreadablePdf: "This PDF could not be read. It may be damaged or not a real PDF.",
  unreadableImage: "The browser could not read this image. It may be damaged.",
  noPages: "This PDF has no pages.",
  engine: "The OCR engine could not start. Check your connection, then try again.",
  failed: "The text could not be read from this file.",
  nothingFound: "No text was found. Try a sharper, straighter photo with more light.",
} as const;

const IMAGE_TYPES: Record<string, true> = {
  "image/png": true,
  "image/jpeg": true,
  "image/webp": true,
};

/** What kind of file this is, from its media type or, when the browser gave none, its extension. */
export function inputKindOf(file: { name: string; type: string }): InputKind | undefined {
  if (file.type === "application/pdf") return "pdf";
  if (IMAGE_TYPES[file.type]) return "image";
  if (file.type !== "") return;
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (extension === "pdf") return "pdf";
  if (extension === "png" || extension === "jpg" || extension === "jpeg" || extension === "webp") {
    return "image";
  }
  return;
}

/** The kind of the file, or why it is refused. */
export function checkFile(file: {
  name: string;
  type: string;
  size: number;
}): { ok: true; kind: InputKind } | { ok: false; error: string } {
  const kind = inputKindOf(file);
  if (!kind) return { ok: false, error: MESSAGES.unsupported };
  if (file.size > LIMITS.maxInputBytes) {
    return { ok: false, error: MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes)) };
  }
  return { ok: true, kind };
}

/** True when a PDF of this many pages may be read. Exactly 20 pages is allowed. */
export function withinPageLimit(pages: number): boolean {
  return pages >= 1 && pages <= MAX_PAGES;
}

/** The size a picture of `width` by `height` is read at: at most MAX_SIDE on the longer side. */
export function readSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_SIDE) return { width, height };
  const scale = MAX_SIDE / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The scale a PDF page of `width` by `height` points is drawn at: 300 dpi, within MAX_SIDE. */
export function pdfScale(width: number, height: number): number {
  const wanted = PDF_DPI / POINTS_PER_INCH;
  const longest = Math.max(width, height);
  if (longest <= 0) return wanted;
  return Math.min(wanted, MAX_SIDE / longest);
}

/** The languages a choice downloads, as Tesseract names them. */
export function languagesOf(choice: LanguageChoice): readonly Language[] {
  return LANGUAGE_CHOICES[choice].languages;
}

/** What the first use of a choice downloads, in bytes: the engine and the chosen language data. */
export function firstDownloadBytes(choice: LanguageChoice): number {
  return languagesOf(choice).reduce(
    (sum, language) => sum + LANGUAGES[language].bytes,
    ENGINE_BYTES,
  );
}

/** Tidies what Tesseract gives back: no trailing spaces, at most one blank line in a row. */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The text of every page, one after another; a PDF's pages are headed `Page 1`, `Page 2`. */
export function joinPages(pages: readonly PageText[], kind: InputKind): string {
  if (kind === "image") return tidyText(pages[0]?.text ?? "");
  return pages.map(({ page, text }) => `Page ${page}\n\n${tidyText(text)}`.trim()).join("\n\n");
}

/** True when nothing but white space was found. */
export function isEmptyResult(pages: readonly PageText[]): boolean {
  return pages.every((page) => tidyText(page.text) === "");
}

/** `receipt.jpg` gives `receipt.txt`. */
export function textName(inputName: string): string {
  const base = inputName.replace(/\.[a-z0-9]{1,5}$/i, "");
  return safeFilename(`${base}.txt`, { extension: "txt", fallback: "text" });
}

/** Bytes as a person reads them, in steps of 1,024: `980 bytes`, `612 KB`, `2.4 MB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
