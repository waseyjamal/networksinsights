// Pure logic of "Blur & Censor Image": the file rules, the regions the visitor draws, the size a
// picture is worked on at, and the three ways to hide a region (solid fill, pixelate, blur), done
// on raw RGBA pixels, with no DOM, no network and no top-level statements (docs/tool-contract.md).
// ui.tsx decodes and encodes the picture with a canvas; worker.ts runs `censor` on its pixels.

export const LIMITS = {
  maxInputBytes: 25 * 1024 * 1024,
  maxFiles: 1,
  /** Regions on one picture: our own choice. */
  maxRegions: 50,
} as const;

/** The largest picture read: 50 megapixels, under 200 MB of memory decoded. */
export const MAX_PIXELS = 50_000_000;

/**
 * A larger picture is scaled down to this many pixels before it is worked on: our own choice,
 * under the 16,777,216-pixel canvas limit of Safari on iPhone and iPad.
 */
export const WORK_PIXELS = 16_000_000;

/** The preview on the page is at most this many pixels on its longer side. */
export const PREVIEW_MAX_SIDE = 1200;

/** JPG is saved at this quality: our own choice. */
export const QUALITY = 0.92;

/** The smallest region, as a fraction of the picture: smaller drags are taken as a click. */
export const MIN_REGION = 0.005;

export const RANGES = {
  /** Pixelate: the side of one block, in pixels of the result. */
  block: { min: 2, max: 200 },
  /** Blur: the radius, in pixels of the result. */
  radius: { min: 1, max: 100 },
} as const;

export const MODES = {
  fill: "Solid fill",
  pixelate: "Pixelate",
  blur: "Blur",
} as const;

export type Mode = keyof typeof MODES;

export const INPUT_TYPES = {
  "image/jpeg": { label: "JPG", extension: "jpg" },
  "image/png": { label: "PNG", extension: "png" },
  "image/webp": { label: "WebP", extension: "webp" },
} as const;

export type ImageType = keyof typeof INPUT_TYPES;

export const OUTPUT_TYPES = {
  "image/png": { label: "PNG", extension: "png" },
  "image/jpeg": { label: "JPG", extension: "jpg" },
} as const;

export type OutputType = keyof typeof OUTPUT_TYPES;

/** A region, as fractions of the picture as it is seen (0 to 1 from the top left). */
export interface Region {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  mode: Mode;
  /** HEX colour of a solid fill, #rrggbb. */
  color: string;
  block: number;
  radius: number;
}

/** Kept for the manifest's input schema. */
export interface Input {
  regions: Omit<Region, "id">[];
  format: OutputType;
}

export interface Job {
  width: number;
  height: number;
  /** RGBA, row by row, 4 bytes a pixel. */
  pixels: Uint8ClampedArray;
  regions: Region[];
}

export interface JobResult {
  pixels: Uint8ClampedArray;
}

export const MESSAGES = {
  notAnImage: "This file is not a JPG, PNG or WebP image.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  unreadable: "This image could not be read. It may be damaged.",
  tooManyPixels: "This image has more than 50 megapixels, more than the browser can hold.",
  scaled: (from: string, to: string) =>
    `This picture is ${from} pixels, over 16 megapixels, so it was scaled down to ${to} pixels. The result has that size.`,
  place: "Each region needs a left, top, width and height from 0 to 100%.",
  noRegions: "Draw at least one region over what you want to hide.",
  tooManyRegions: `A picture can have up to ${LIMITS.maxRegions} regions.`,
  color: "Use a HEX colour with 6 digits, such as #000000.",
  range: (label: string, min: number, max: number) =>
    `${label} must be a whole number from ${min} to ${max}.`,
  failed: "The picture could not be made.",
} as const;

export function imageTypeOf(file: { name: string; type: string }): ImageType | undefined {
  if (file.type in INPUT_TYPES) return file.type as ImageType;
  if (file.type !== "") return;
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return;
}

export function checkFile(file: { name: string; type: string; size: number }): string | null {
  if (!imageTypeOf(file)) return MESSAGES.notAnImage;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return null;
}

export function withinPixelLimit(width: number, height: number): boolean {
  return width > 0 && height > 0 && width * height <= MAX_PIXELS;
}

/** The size a picture is worked on at: its own, or scaled down to at most 16 megapixels. */
export function workSize(width: number, height: number): { width: number; height: number } {
  if (width * height <= WORK_PIXELS) return { width, height };
  const scale = Math.sqrt(WORK_PIXELS / (width * height));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

/** The preview size: at most 1,200 pixels on the longer side, never larger than the picture. */
export function previewSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** A region's place from the corners of a drag, kept on the picture; null when too small. */
export function boxFrom(
  points: ReadonlyArray<{ x: number; y: number }>,
): { x: number; y: number; width: number; height: number } | null {
  if (points.length < 2) return null;
  const xs = points.map((point) => clamp(point.x));
  const ys = points.map((point) => clamp(point.y));
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  if (width < MIN_REGION || height < MIN_REGION) return null;
  return { x, y, width, height };
}

/** A region moved to a new top left corner, still wholly on the picture. */
export function moveRegion(region: Region, x: number, y: number): Region {
  return {
    ...region,
    x: Math.min(1 - region.width, Math.max(0, x)),
    y: Math.min(1 - region.height, Math.max(0, y)),
  };
}

/** A region resized from its top left corner, kept on the picture and at least MIN_REGION. */
export function resizeRegion(region: Region, width: number, height: number): Region {
  return {
    ...region,
    width: Math.min(1 - region.x, Math.max(MIN_REGION, width)),
    height: Math.min(1 - region.y, Math.max(MIN_REGION, height)),
  };
}

/** A region in whole pixels, grown outward so no edge pixel is left half covered. */
export function regionPixels(
  region: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
) {
  const left = Math.max(0, Math.floor(region.x * width));
  const top = Math.max(0, Math.floor(region.y * height));
  const right = Math.min(width, Math.ceil((region.x + region.width) * width));
  const bottom = Math.min(height, Math.ceil((region.y + region.height) * height));
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function normalizeHex(text: string): string | null {
  const digits = text.trim().replace(/^#/, "").toLowerCase();
  return /^[0-9a-f]{6}$/.test(digits) ? `#${digits}` : null;
}

/** The first problem with the regions, or null. */
export function checkRegions(regions: readonly Region[]): string | null {
  if (regions.length === 0) return MESSAGES.noRegions;
  if (regions.length > LIMITS.maxRegions) return MESSAGES.tooManyRegions;
  for (const region of regions) {
    const problem = checkRegion(region);
    if (problem) return problem;
  }
  return null;
}

/** The problem with one region's setting, or null. */
export function checkRegion(region: Region): string | null {
  const place = [region.x, region.y, region.width, region.height];
  if (place.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    return MESSAGES.place;
  }
  if (region.width < MIN_REGION || region.height < MIN_REGION) return MESSAGES.place;
  if (region.mode === "fill" && !normalizeHex(region.color)) return MESSAGES.color;
  if (region.mode === "pixelate") return checkWhole(region.block, "Block size", RANGES.block);
  if (region.mode === "blur") return checkWhole(region.radius, "Blur radius", RANGES.radius);
  return null;
}

function checkWhole(value: number, label: string, range: { min: number; max: number }) {
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    return MESSAGES.range(label, range.min, range.max);
  }
  return null;
}

type Rect = { x: number; y: number; width: number; height: number };

/** Every pixel of the rectangle becomes the colour, fully opaque. */
export function fillRect(pixels: Uint8ClampedArray, width: number, rect: Rect, color: string) {
  const hex = normalizeHex(color) ?? "#000000";
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }
}

/**
 * Blocks of `block` by `block` pixels from the rectangle's top left corner, each set to the
 * average of its pixels. A block cut by the right or bottom edge of the rectangle is smaller.
 */
export function pixelateRect(pixels: Uint8ClampedArray, width: number, rect: Rect, block: number) {
  for (let by = rect.y; by < rect.y + rect.height; by += block) {
    for (let bx = rect.x; bx < rect.x + rect.width; bx += block) {
      const right = Math.min(bx + block, rect.x + rect.width);
      const bottom = Math.min(by + block, rect.y + rect.height);
      const sum = [0, 0, 0, 0];
      for (let y = by; y < bottom; y++) {
        for (let x = bx; x < right; x++) {
          const i = (y * width + x) * 4;
          for (let c = 0; c < 4; c++) sum[c] = (sum[c] ?? 0) + (pixels[i + c] ?? 0);
        }
      }
      const count = (right - bx) * (bottom - by);
      const mean = sum.map((value) => Math.round(value / count));
      for (let y = by; y < bottom; y++) {
        for (let x = bx; x < right; x++) {
          const i = (y * width + x) * 4;
          for (let c = 0; c < 4; c++) pixels[i + c] = mean[c] ?? 0;
        }
      }
    }
  }
}

/**
 * Three passes of a box blur of `radius` across and then down, which is close to a Gaussian blur.
 * It reads only pixels inside the rectangle (an edge pixel repeats beyond it), so nothing outside
 * the rectangle changes or leaks in.
 */
export function blurRect(pixels: Uint8ClampedArray, width: number, rect: Rect, radius: number) {
  if (rect.width === 0 || rect.height === 0) return;
  const w = rect.width;
  const h = rect.height;
  const work = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from = ((rect.y + y) * width + rect.x + x) * 4;
      for (let c = 0; c < 4; c++) work[(y * w + x) * 4 + c] = pixels[from + c] ?? 0;
    }
  }
  const spare = new Float32Array(w * h * 4);
  for (let pass = 0; pass < 3; pass++) {
    boxPass(work, spare, w, h, radius, true);
    boxPass(spare, work, w, h, radius, false);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const to = ((rect.y + y) * width + rect.x + x) * 4;
      for (let c = 0; c < 4; c++) pixels[to + c] = Math.round(work[(y * w + x) * 4 + c] ?? 0);
    }
  }
}

/** One box blur along rows (`across`) or columns, edge pixels repeated, with a running sum. */
function boxPass(
  from: Float32Array,
  to: Float32Array,
  w: number,
  h: number,
  radius: number,
  across: boolean,
) {
  const lines = across ? h : w;
  const length = across ? w : h;
  const size = radius * 2 + 1;
  const at = (line: number, k: number) => {
    const p = Math.min(length - 1, Math.max(0, k));
    return (across ? line * w + p : p * w + line) * 4;
  };
  for (let line = 0; line < lines; line++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += from[at(line, k) + c] ?? 0;
      for (let k = 0; k < length; k++) {
        to[at(line, k) + c] = sum / size;
        sum += (from[at(line, k + radius + 1) + c] ?? 0) - (from[at(line, k - radius) + c] ?? 0);
      }
    }
  }
}

/** Hides every region in turn, in the order given, so a later region is drawn over an earlier one. */
export function censor(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  regions: readonly Region[],
) {
  for (const region of regions) {
    const rect = regionPixels(region, width, height);
    if (region.mode === "fill") fillRect(pixels, width, rect, region.color);
    else if (region.mode === "pixelate") pixelateRect(pixels, width, rect, region.block);
    else blurRect(pixels, width, rect, region.radius);
  }
}

/** `street.jpg` saved as PNG gives `street-censored.png`. */
export function outputName(name: string, type: OutputType): string {
  const base = name.replace(/\.[a-z0-9]{1,5}$/i, "").trim() || "image";
  return `${base}-censored.${OUTPUT_TYPES[type].extension}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** 4000 and 3000 give "4,000 × 3,000". */
export function formatDimensions(width: number, height: number): string {
  const group = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${group(width)} × ${group(height)}`;
}
