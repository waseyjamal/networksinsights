// Pure logic of "Passport Photo Maker": the file rules, photo and paper sizes, the crop frame, the
// print sheet layout and the DPI written into the JPG, with no DOM, no network and no top-level
// statements (docs/tool-contract.md, "logic.ts: what pure means"). ui.tsx draws on a canvas.

export const LIMITS = {
  /** 25 MB, one picture at a time. */
  maxInputBytes: 25 * 1024 * 1024,
  maxFiles: 1,
} as const;

/** The most pixels a source picture may have: 50 megapixels. */
export const MAX_PIXELS = 50_000_000;

/**
 * The most pixels an output may have: 4,096 by 4,096, the largest canvas Safari on iPhone and iPad
 * allows.
 */
export const MAX_OUTPUT_PIXELS = 16_777_216;

export const MM_PER_INCH = 25.4;

/** Dots per inch: 150 to 600. 300 is the usual setting for photo printing (a rule of thumb). */
export const DPI = { min: 150, max: 600, initial: 300 } as const;

/** A photo's custom size: 10 to 100 mm, or 0.4 to 3.9 inches, on each side. Our own choice. */
export const SIDE_MM = { min: 10, max: 100 } as const;
export const SIDE_IN = { min: 0.4, max: 3.9 } as const;

/** The date the preset sizes were last checked on their official sources. */
export const CHECKED = "5 October 2026";

/**
 * Preset sizes, each checked on its official source on CHECKED. The page shows the source and the
 * date next to the choice. A preset is only a size: it says nothing about whether a photo is
 * accepted.
 */
export const PRESETS = {
  us: {
    label: "United States passport: 2 × 2 inches (51 × 51 mm)",
    widthMm: 50.8,
    heightMm: 50.8,
    source: "https://travel.state.gov/content/travel/en/passports/how-apply/photos.html",
    sourceName: "travel.state.gov, U.S. Passport Photos",
  },
  uk: {
    label: "United Kingdom passport, printed: 35 × 45 mm",
    widthMm: 35,
    heightMm: 45,
    source: "https://www.gov.uk/photos-for-passports/photo-requirements",
    sourceName: "GOV.UK, Photos for passports: photo requirements",
  },
} as const;

export type Preset = keyof typeof PRESETS;
export type SizeChoice = Preset | "custom";
export type Unit = "mm" | "in";

/** Paper for the print sheet, in millimetres, portrait. */
export const PAPERS = {
  "4x6": { label: "4 × 6 inches (10 × 15 cm photo paper)", widthMm: 101.6, heightMm: 152.4 },
  "5x7": { label: "5 × 7 inches", widthMm: 127, heightMm: 177.8 },
  a4: { label: "A4 (210 × 297 mm)", widthMm: 210, heightMm: 297 },
} as const;

export type Paper = keyof typeof PAPERS;

/** The white margin around the sheet and the gap between copies, in mm. Our own choice. */
export const SHEET_MARGIN_MM = 3;
export const SHEET_GAP_MM = 2;

/** Kept for the manifest's input schema. */
export interface Input {
  size: SizeChoice;
  width: number;
  height: number;
  unit: Unit;
  dpi: number;
  paper: Paper;
}

export const MESSAGES = {
  notAnImage: "This file is not a JPG, PNG or WebP picture.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooManyPixels: "This picture has more than 50 megapixels.",
  unreadable: "This picture could not be read. It may be damaged.",
  width: (unit: Unit) => `The width must be a number from ${sideRange(unit)}.`,
  height: (unit: Unit) => `The height must be a number from ${sideRange(unit)}.`,
  dpi: `The DPI must be a whole number from ${DPI.min} to ${DPI.max}.`,
  sheetTooBig:
    "This sheet would be larger than 16.7 megapixels, more than some phones can draw. Choose a smaller paper or a lower DPI.",
  noFit: "Not even one photo of this size fits on this paper.",
  failed: "The photo could not be made.",
} as const;

function sideRange(unit: Unit): string {
  return unit === "mm"
    ? `${SIDE_MM.min} to ${SIDE_MM.max} mm`
    : `${SIDE_IN.min} to ${SIDE_IN.max} inches`;
}

const TYPES = ["image/jpeg", "image/png", "image/webp"];

export function isImage(file: { name: string; type: string }): boolean {
  if (TYPES.includes(file.type)) return true;
  return file.type === "" && /\.(jpe?g|png|webp)$/i.test(file.name);
}

export function checkFile(file: { name: string; type: string; size: number }): string | undefined {
  if (!isImage(file)) return MESSAGES.notAnImage;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return;
}

export function withinPixelLimit(width: number, height: number): boolean {
  return width > 0 && height > 0 && width * height <= MAX_PIXELS;
}

/** A decimal number from text, with a point or a comma, or undefined. */
export function parseDecimal(text: string): number | undefined {
  const cleaned = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return;
  return Number(cleaned);
}

/** Millimetres to pixels at a DPI, rounded to the nearest pixel. */
export function mmToPixels(mm: number, dpi: number): number {
  return Math.round((mm / MM_PER_INCH) * dpi);
}

export interface PhotoSize {
  widthMm: number;
  heightMm: number;
  dpi: number;
  width: number;
  height: number;
}

/** The photo's size in mm and in pixels, from the form, or an error. */
export function photoSize(form: {
  size: SizeChoice;
  width: string;
  height: string;
  unit: Unit;
  dpi: string;
}): { ok: true; size: PhotoSize } | { ok: false; error: string } {
  const dpiText = form.dpi.trim();
  const dpi = /^\d+$/.test(dpiText) ? Number(dpiText) : Number.NaN;
  if (!(dpi >= DPI.min && dpi <= DPI.max)) return { ok: false, error: MESSAGES.dpi };
  let widthMm: number;
  let heightMm: number;
  if (form.size === "custom") {
    const range = form.unit === "in" ? SIDE_IN : SIDE_MM;
    const factor = form.unit === "in" ? MM_PER_INCH : 1;
    const width = parseDecimal(form.width);
    const height = parseDecimal(form.height);
    const inRange = (value: number) => value >= range.min && value <= range.max;
    if (typeof width === "undefined" || !inRange(width)) {
      return { ok: false, error: MESSAGES.width(form.unit) };
    }
    if (typeof height === "undefined" || !inRange(height)) {
      return { ok: false, error: MESSAGES.height(form.unit) };
    }
    widthMm = width * factor;
    heightMm = height * factor;
  } else {
    widthMm = PRESETS[form.size].widthMm;
    heightMm = PRESETS[form.size].heightMm;
  }
  return {
    ok: true,
    size: {
      widthMm,
      heightMm,
      dpi,
      width: mmToPixels(widthMm, dpi),
      height: mmToPixels(heightMm, dpi),
    },
  };
}

/** The crop frame, in source pixels. Its shape always matches the photo's. */
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Keeps a frame of the given width (and the photo's shape) inside the picture. */
export function clampFrame(
  frame: { x: number; y: number; width: number },
  image: { width: number; height: number },
  aspect: number,
): Frame {
  const maxWidth = Math.min(image.width, image.height * aspect);
  const minWidth = Math.min(maxWidth, Math.max(1, maxWidth * 0.1));
  const width = Math.min(Math.max(frame.width, minWidth), maxWidth);
  const height = width / aspect;
  const x = Math.min(Math.max(frame.x, 0), image.width - width);
  const y = Math.min(Math.max(frame.y, 0), image.height - height);
  return { x, y, width, height };
}

/** The largest frame of the photo's shape, centred. */
export function initialFrame(image: { width: number; height: number }, aspect: number): Frame {
  const width = Math.min(image.width, image.height * aspect);
  return clampFrame(
    { x: (image.width - width) / 2, y: (image.height - width / aspect) / 2, width },
    image,
    aspect,
  );
}

/** The frame resized by a factor around its centre, then kept inside the picture. */
export function scaleFrame(
  frame: Frame,
  factor: number,
  image: { width: number; height: number },
  aspect: number,
): Frame {
  const width = frame.width * factor;
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  return clampFrame({ x: cx - width / 2, y: cy - width / aspect / 2, width }, image, aspect);
}

export interface Sheet {
  width: number;
  height: number;
  landscape: boolean;
  columns: number;
  rows: number;
  /** The top-left corner of each copy, in sheet pixels. */
  positions: Array<[number, number]>;
}

function fit(paperW: number, paperH: number, photoW: number, photoH: number) {
  const usableW = paperW - 2 * SHEET_MARGIN_MM;
  const usableH = paperH - 2 * SHEET_MARGIN_MM;
  const columns = Math.max(0, Math.floor((usableW + SHEET_GAP_MM) / (photoW + SHEET_GAP_MM)));
  const rows = Math.max(0, Math.floor((usableH + SHEET_GAP_MM) / (photoH + SHEET_GAP_MM)));
  return { columns, rows };
}

/**
 * As many copies as fit on the paper, upright, in portrait or landscape, whichever holds more
 * (portrait on a tie). Copies are centred on the paper as a block.
 */
export function sheetLayout(
  paper: Paper,
  photo: PhotoSize,
): { ok: true; sheet: Sheet } | { ok: false; error: string } {
  const { widthMm, heightMm } = PAPERS[paper];
  const portrait = fit(widthMm, heightMm, photo.widthMm, photo.heightMm);
  const landscapeFit = fit(heightMm, widthMm, photo.widthMm, photo.heightMm);
  const landscape = landscapeFit.columns * landscapeFit.rows > portrait.columns * portrait.rows;
  const { columns, rows } = landscape ? landscapeFit : portrait;
  if (columns * rows === 0) return { ok: false, error: MESSAGES.noFit };
  const paperW = landscape ? heightMm : widthMm;
  const paperH = landscape ? widthMm : heightMm;
  const width = mmToPixels(paperW, photo.dpi);
  const height = mmToPixels(paperH, photo.dpi);
  if (width * height > MAX_OUTPUT_PIXELS) return { ok: false, error: MESSAGES.sheetTooBig };
  const blockW = columns * photo.widthMm + (columns - 1) * SHEET_GAP_MM;
  const blockH = rows * photo.heightMm + (rows - 1) * SHEET_GAP_MM;
  const left = (paperW - blockW) / 2;
  const top = (paperH - blockH) / 2;
  const positions: Array<[number, number]> = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      positions.push([
        mmToPixels(left + column * (photo.widthMm + SHEET_GAP_MM), photo.dpi),
        mmToPixels(top + row * (photo.heightMm + SHEET_GAP_MM), photo.dpi),
      ]);
    }
  }
  return { ok: true, sheet: { width, height, landscape, columns, rows, positions } };
}

/**
 * The JPG with its resolution set to `dpi` in the JFIF header, so a print program sizes it right.
 * A JPG without a JFIF header gets one after its start marker.
 */
export function withJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const isJfif =
    bytes[2] === 0xff &&
    bytes[3] === 0xe0 &&
    bytes[6] === 0x4a &&
    bytes[7] === 0x46 &&
    bytes[8] === 0x49 &&
    bytes[9] === 0x46 &&
    bytes[10] === 0x00;
  const high = (dpi >> 8) & 0xff;
  const low = dpi & 0xff;
  if (isJfif) {
    const out = bytes.slice();
    out[13] = 1;
    out[14] = high;
    out[15] = low;
    out[16] = high;
    out[17] = low;
    return out;
  }
  const app0 = Uint8Array.from([
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x01,
    high,
    low,
    high,
    low,
    0x00,
    0x00,
  ]);
  const out = new Uint8Array(bytes.length + app0.length);
  out.set(bytes.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(bytes.subarray(2), 2 + app0.length);
  return out;
}

/** The DPI written in a JPG's JFIF header, or undefined. */
export function readJpegDpi(bytes: Uint8Array): number | undefined {
  if (bytes[2] !== 0xff || bytes[3] !== 0xe0 || bytes[13] !== 1) return;
  return ((bytes[14] ?? 0) << 8) | (bytes[15] ?? 0);
}

/** `me.png` becomes `me-passport-413x531.jpg`, or `me-sheet-4x6.jpg`. */
export function outputName(inputName: string, kind: "photo" | "sheet", detail: string): string {
  const base = inputName.replace(/\.[^.]+$/, "").trim() || "photo";
  return `${base}-${kind === "photo" ? "passport" : "sheet"}-${detail}.jpg`;
}

export function formatMm(mm: number): string {
  return `${Math.round(mm * 10) / 10} mm`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
