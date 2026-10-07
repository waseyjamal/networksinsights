// Pure logic of "Crop PDF": the file rules, the margins to cut, and the new page box of each page,
// with no DOM, no network and no top-level statements (docs/tool-contract.md). worker.ts draws the
// preview with PDF.js and sets the boxes with pdf-lib (ADR 0057). Margins are given for the page
// as it is seen, so a page turned with /Rotate has its margins mapped to the sides of its box.

export const LIMITS = {
  /** 50 MB, one PDF at a time. */
  maxInputBytes: 50 * 1024 * 1024,
  maxFiles: 1,
  /** The largest margin, in millimetres. */
  maxMarginMm: 1000,
} as const;

/** Where the worker finds PDF.js's data files (ADR 0057). */
export const PDFJS_ASSETS = "/vendor/pdfjs/6.3.289/";
/** The preview is at most this many pixels on its longer side. */
export const PREVIEW_MAX_SIDE = 1200;
/** What is left of a page must be at least this many points on each side (about 3.5 mm). */
export const MIN_SIDE_PT = 10;

export const POINTS_PER_MM = 72 / 25.4;

export type Side = "top" | "right" | "bottom" | "left";
export const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];

/** Margins to cut, in points, from the page as it is seen. */
export type Margins = Record<Side, number>;

/** A PDF rectangle: lower-left corner, width and height, in points. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Kept for the manifest's input schema: the margins in millimetres, as typed. */
export interface Input {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

export type Job = { kind: "open"; file: Blob } | { kind: "crop"; file: Blob; margins: Margins };

export interface Preview {
  /** Null when this browser cannot draw the page in a worker (no OffscreenCanvas). */
  blob: Blob | null;
  /** The first page as it is seen, in points. */
  seenWidth: number;
  seenHeight: number;
}

export type JobResult =
  | { kind: "open"; pages: number; preview: Preview }
  | { kind: "crop"; blob: Blob; pages: number };

export const MESSAGES = {
  notAPdf: "This file is not a PDF.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  encrypted:
    "This PDF is protected with a password. Remove the password in the program that made it, then try again.",
  unreadable: "This PDF could not be read. It may be damaged or not a real PDF.",
  noPages: "This PDF has no pages.",
  renderFailed: "The preview of this page could not be drawn.",
  noPreview:
    "This browser cannot draw the page here, so the outline is shown on a blank page of the same shape. Cropping works the same.",
  badMargin: (side: Side) =>
    `The ${side} margin must be a number of millimetres from 0 to ${LIMITS.maxMarginMm}.`,
  nothing: "Every margin is 0, so nothing would be cut. Type at least one margin.",
  tooMuch: (page: number) =>
    `These margins leave nothing of page ${page}. Make them smaller: at least ${MIN_SIDE_PT} points (about 3.5 mm) must remain each way.`,
  failed: "The PDF could not be cropped.",
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

/** Millimetres typed in the four boxes, as points; an empty box is 0. */
export function parseMargins(
  input: Input,
): { ok: true; margins: Margins } | { ok: false; error: string } {
  const margins: Margins = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const side of SIDES) {
    const text = input[side].trim().replace(",", ".");
    if (text === "") continue;
    if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: MESSAGES.badMargin(side) };
    const mm = Number(text);
    if (mm > LIMITS.maxMarginMm) return { ok: false, error: MESSAGES.badMargin(side) };
    margins[side] = mm * POINTS_PER_MM;
  }
  if (SIDES.every((side) => margins[side] === 0)) return { ok: false, error: MESSAGES.nothing };
  return { ok: true, margins };
}

/** A rotation as one of 0, 90, 180, 270. */
export function normalRotation(degrees: number): 0 | 90 | 180 | 270 {
  const turned = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
  return turned as 0 | 90 | 180 | 270;
}

/**
 * The margins on the sides of the unrotated box. /Rotate turns the page clockwise for display, so
 * at 90° the box's left side is seen at the top, its top on the right, and so on.
 */
export function boxMargins(seen: Margins, rotation: number): Margins {
  switch (normalRotation(rotation)) {
    case 90:
      return { left: seen.top, top: seen.right, right: seen.bottom, bottom: seen.left };
    case 180:
      return { bottom: seen.top, left: seen.right, top: seen.bottom, right: seen.left };
    case 270:
      return { right: seen.top, bottom: seen.right, left: seen.bottom, top: seen.left };
    default:
      return { ...seen };
  }
}

/** The page box after cutting `seen` margins, or null when too little would be left. */
export function cropBox(box: Box, rotation: number, seen: Margins): Box | null {
  const cut = boxMargins(seen, rotation);
  const width = box.width - cut.left - cut.right;
  const height = box.height - cut.top - cut.bottom;
  if (width < MIN_SIDE_PT || height < MIN_SIDE_PT) return null;
  return { x: box.x + cut.left, y: box.y + cut.bottom, width, height };
}

/** A page's size as it is seen: width and height swap when it is turned a quarter. */
export function seenSize(box: Box, rotation: number): { width: number; height: number } {
  const turned = normalRotation(rotation) % 180 === 90;
  return turned
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height };
}

/** The part of the preview that is kept, as fractions of the page as seen (0 to 1, top left). */
export function keptArea(
  seenWidth: number,
  seenHeight: number,
  seen: Margins,
): { x: number; y: number; width: number; height: number } {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const x = clamp(seen.left / seenWidth);
  const y = clamp(seen.top / seenHeight);
  return {
    x,
    y,
    width: clamp(1 - x - seen.right / seenWidth),
    height: clamp(1 - y - seen.bottom / seenHeight),
  };
}

/** `scan.pdf` becomes `scan-cropped.pdf`. */
export function outputName(inputName: string): string {
  const base = inputName.replace(/\.pdf$/i, "").trim() || "document";
  return `${base}-cropped.pdf`;
}

/** Points as millimetres, one decimal: 595.28 pt is "210.0 mm". */
export function formatMm(points: number): string {
  return `${(points / POINTS_PER_MM).toFixed(1)} mm`;
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
