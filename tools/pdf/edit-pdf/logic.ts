// Pure logic of "Edit PDF": the limits, the items a visitor adds (text, pictures, drawings,
// highlights and white boxes), where each lands in the PDF's own coordinates on a page that may be
// turned or cropped, and which characters the standard PDF fonts can draw. No DOM, no network and
// no top-level statements (docs/tool-contract.md, "logic.ts: what pure means"). worker.ts draws
// the pages with PDF.js and saves the edits with pdf-lib (ADR 0057).

/** The limits the manifest declares and the page enforces: one source for both. */
export const LIMITS = {
  /** 50 MB for the PDF. */
  maxInputBytes: 50 * 1024 * 1024,
  /** One PDF at a time. */
  maxFiles: 1,
  /** 100 pages: every page can be edited, and each is drawn again when it is shown. */
  maxPages: 100,
  /** 5 MB per picture added. */
  maxImageBytes: 5 * 1024 * 1024,
  /** 500 characters in one text item. */
  maxTextLength: 500,
} as const;

/**
 * The longest side of a page preview, in pixels. 1,600 by 1,600 is 2,560,000 pixels, far below the
 * 16,777,216 pixels Safari on iPhone and iPad allows for one canvas, and only one page is drawn
 * at a time.
 */
export const PREVIEW_MAX_SIDE = 1600;

/** PDF.js's data files, served from this site (ADR 0057). Keep the version in step with pdfjs-dist. */
export const PDFJS_ASSETS = "/vendor/pdfjs/6.3.289/";

export const FONTS = {
  helvetica: { label: "Helvetica (sans-serif)", css: "Helvetica, Arial, sans-serif" },
  times: { label: "Times (serif)", css: '"Times New Roman", Times, serif' },
  courier: { label: "Courier (monospace)", css: '"Courier New", Courier, monospace' },
} as const;
export type Font = keyof typeof FONTS;

export const COLORS = {
  black: { label: "Black", rgb: [0, 0, 0], css: "#000000" },
  blue: { label: "Blue", rgb: [0.1, 0.25, 0.75], css: "#1a40bf" },
  red: { label: "Red", rgb: [0.8, 0.1, 0.1], css: "#cc1a1a" },
} as const;
export type Color = keyof typeof COLORS;

/** Highlights are see-through yellow, drawn over the page. */
export const HIGHLIGHT = {
  rgb: [1, 0.9, 0.2],
  opacity: 0.4,
  css: "rgba(255, 230, 51, 0.4)",
} as const;

/** Text sizes offered, in points. */
export const TEXT_SIZES = [8, 10, 12, 14, 18, 24, 36, 48] as const;

/** The pen's width for drawings, in points. */
export const PEN_WIDTH = 2;

/** One line of text, from its top: the baseline sits at 0.9 of the size, lines are 1.2 apart. */
export const BASELINE = 0.9;
export const LINE_HEIGHT = 1.2;

/** Fractions of the page as it is seen: 0 to 1 from the top left. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Item =
  | {
      kind: "text";
      id: string;
      page: number;
      x: number;
      y: number;
      text: string;
      font: Font;
      size: number;
      color: Color;
    }
  | { kind: "image"; id: string; page: number; box: Box; imageId: string }
  | {
      kind: "drawing";
      id: string;
      page: number;
      strokes: Array<Array<{ x: number; y: number }>>;
      color: Color;
    }
  | { kind: "highlight"; id: string; page: number; box: Box }
  | { kind: "whitebox"; id: string; page: number; box: Box };

export type ItemKind = Item["kind"];

/** A page as PDF.js and pdf-lib see it: its visible box in PDF points, and its turn. */
export interface PageGeometry {
  /** The crop box: what a viewer shows, in the page's own coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Clockwise turn in degrees, from the page's /Rotate. */
  rotation: number;
}

export interface Picture {
  id: string;
  bytes: Uint8Array;
  type: "png" | "jpg";
  width: number;
  height: number;
}

export type Job =
  | { kind: "open"; file: Blob }
  | { kind: "render"; page: number }
  | { kind: "save"; file: Blob; items: Item[]; pictures: Picture[] };

export interface PageView {
  page: number;
  blob: Blob;
  /** The page as it is seen, in points (turned when the page is turned). */
  seenWidth: number;
  seenHeight: number;
  pixelWidth: number;
  pixelHeight: number;
}

export type JobResult =
  | { kind: "open"; pages: number }
  | { kind: "render"; view: PageView }
  | { kind: "save"; blob: Blob };

export const MESSAGES = {
  notPdf: "This file is not a PDF. Choose a file that ends in .pdf.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooManyPages: (count: number) =>
    `This PDF has ${count} pages. Edit PDF opens PDFs of up to ${LIMITS.maxPages} pages: split it first, then edit each part.`,
  encrypted:
    "This PDF is protected with a password or encryption, so it cannot be edited here. Remove the protection first with the program that made it.",
  unreadable: "This PDF could not be read. It may be damaged.",
  noPages: "This PDF has no pages.",
  notPicture: "Choose a JPG or PNG picture.",
  pictureTooLarge: "This picture is larger than 5 MB.",
  textTooLong: `A text item holds up to ${LIMITS.maxTextLength} characters.`,
  cannotDraw: (characters: string) =>
    `The standard PDF fonts cannot draw these characters: ${characters}. Remove them to save.`,
  failed: "The PDF could not be saved.",
  renderFailed: "This page could not be shown.",
} as const;

export function isPdf(file: { name: string; type: string }): boolean {
  if (file.type === "application/pdf") return true;
  return (
    (file.type === "" || file.type === "application/octet-stream") && /\.pdf$/i.test(file.name)
  );
}

/** Refuses a PDF before it is read: the wrong kind, or one byte over the size limit. */
export function checkFile(file: { name: string; type: string; size: number }): string | null {
  if (!isPdf(file)) return MESSAGES.notPdf;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return null;
}

/** Refuses a PDF once its pages are counted. Exactly the limit is fine. */
export function checkPages(count: number): string | null {
  if (count === 0) return MESSAGES.noPages;
  if (count > LIMITS.maxPages) return MESSAGES.tooManyPages(count);
  return null;
}

/** Refuses a picture: only JPG and PNG, up to 5 MB. */
export function checkPicture(file: { name: string; type: string; size: number }): string | null {
  const type = pictureType(file);
  if (!type) return MESSAGES.notPicture;
  if (file.size > LIMITS.maxImageBytes) return MESSAGES.pictureTooLarge;
  return null;
}

export function pictureType(file: { name: string; type: string }): "png" | "jpg" | null {
  if (file.type === "image/png" || (file.type === "" && /\.png$/i.test(file.name))) return "png";
  if (file.type === "image/jpeg" || (file.type === "" && /\.jpe?g$/i.test(file.name))) return "jpg";
  return null;
}

/**
 * The characters of Windows-1252 (WinAnsi), the only encoding pdf-lib's standard fonts can write:
 * printable ASCII, the Latin-1 letters and signs from U+00A0, and the 27 extra signs of 0x80 to
 * 0x9F, given here by code point.
 */
const WINANSI_EXTRA = [
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
];

export function canDraw(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  if (character === "\n") return true;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return WINANSI_EXTRA.includes(code);
}

/** Each character a text cannot be drawn with, once, in the order they appear. */
export function undrawable(text: string): string[] {
  const found: string[] = [];
  for (const character of text)
    if (!canDraw(character) && !found.includes(character)) found.push(character);
  return found;
}

/** Why a text item cannot be saved, or null when it can. */
export function checkText(text: string): string | null {
  if ([...text].length > LIMITS.maxTextLength) return MESSAGES.textTooLong;
  const bad = undrawable(text);
  if (bad.length > 0) return MESSAGES.cannotDraw(bad.join(" "));
  return null;
}

export function normalRotation(rotation: number): number {
  return (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
}

/** The size of a page as it is seen: a page turned a quarter shows its sides swapped. */
export function seenSize(page: PageGeometry): { width: number; height: number } {
  return normalRotation(page.rotation) % 180 === 90
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
}

/**
 * A point given as fractions of the page as seen (from the top left) in the PDF's own coordinates
 * (from the bottom left of the unturned page, including the crop box's offset).
 */
export function toPdfPoint(fx: number, fy: number, page: PageGeometry): { x: number; y: number } {
  const seen = seenSize(page);
  const sx = fx * seen.width;
  const sy = (1 - fy) * seen.height;
  const turn = normalRotation(page.rotation);
  const { width: W, height: H } = page;
  const own =
    turn === 90
      ? { x: W - sy, y: sx }
      : turn === 180
        ? { x: W - sx, y: H - sy }
        : turn === 270
          ? { x: sy, y: H - sx }
          : { x: sx, y: sy };
  return { x: page.x + own.x, y: page.y + own.y };
}

/**
 * A box given as fractions of the seen page, as pdf-lib draws it: the corner that is the bottom
 * left as seen, the size in points, and the turn that keeps it upright as seen.
 */
export function toPdfBox(box: Box, page: PageGeometry) {
  const seen = seenSize(page);
  const corner = toPdfPoint(box.x, box.y + box.height, page);
  return {
    x: corner.x,
    y: corner.y,
    width: box.width * seen.width,
    height: box.height * seen.height,
    rotate: normalRotation(page.rotation),
  };
}

/** Where each line of a text item starts, in the PDF's coordinates, with the turn to draw it at. */
export function textLines(item: Extract<Item, { kind: "text" }>, page: PageGeometry) {
  const seen = seenSize(page);
  return item.text.split("\n").map((line, index) => {
    const fromTop = (item.size * (BASELINE + LINE_HEIGHT * index)) / seen.height;
    return {
      line,
      ...toPdfPoint(item.x, item.y + fromTop, page),
      rotate: normalRotation(page.rotation),
    };
  });
}

/** Keeps a box on the page: no part of it past an edge. */
export function clampBox(box: Box): Box {
  const width = Math.min(1, Math.max(0.01, box.width));
  const height = Math.min(1, Math.max(0.01, box.height));
  return {
    x: Math.min(1 - width, Math.max(0, box.x)),
    y: Math.min(1 - height, Math.max(0, box.y)),
    width,
    height,
  };
}

/** A picture's box at `widthFraction` of the page width, keeping its own shape on this page. */
export function pictureBox(
  picture: { width: number; height: number },
  seen: { width: number; height: number },
  widthFraction: number,
): Box {
  const width = widthFraction;
  const height = (width * seen.width * (picture.height / picture.width)) / seen.height;
  return clampBox({ x: 0.1, y: 0.1, width, height });
}

/** The smallest box around a drawing's strokes. */
export function strokesBox(strokes: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>): Box {
  const points = strokes.flat();
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Moves every point of a drawing by the same amount. */
export function moveStrokes(
  strokes: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>,
  dx: number,
  dy: number,
): Array<Array<{ x: number; y: number }>> {
  return strokes.map((stroke) => stroke.map((point) => ({ x: point.x + dx, y: point.y + dy })));
}

/**
 * The scale to draw a page preview at: the page's longest side becomes `PREVIEW_MAX_SIDE` pixels,
 * whatever the page size, so a huge page never makes a huge canvas.
 */
export function previewScale(width: number, height: number): number {
  const longest = Math.max(width, height);
  if (longest <= 0) return 1;
  return PREVIEW_MAX_SIDE / longest;
}

/** The preview's size in whole pixels: at least 1, at most `PREVIEW_MAX_SIDE` a side. */
export function previewSize(width: number, height: number) {
  const scale = previewScale(width, height);
  const fit = (value: number) => Math.min(PREVIEW_MAX_SIDE, Math.max(1, Math.round(value * scale)));
  return { width: fit(width), height: fit(height) };
}

/** `contract.pdf` becomes `contract-edited.pdf`. */
export function outputName(inputName: string): string {
  const base = inputName.replace(/\.pdf$/i, "").trim() || "document";
  return `${base}-edited.pdf`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
