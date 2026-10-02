// Pure logic of "Photo and Signature Resizer": the size rules and the search for the JPG quality
// that meets a size in KB, with no DOM, no network and no top-level statements
// (docs/tool-contract.md, "logic.ts: what pure means"). worker.ts draws and encodes the pixels.

import { safeFilename } from "@networksinsights/tool-sdk/download";

export const LIMITS = {
  /** 25 MB, one picture at a time. */
  maxInputBytes: 25 * 1024 * 1024,
  maxFiles: 1,
} as const;

/** The largest picture read: 50 megapixels, under 200 MB of memory decoded. */
export const MAX_PIXELS = 50_000_000;

/** The largest side written. Form uploads ask for far less. */
export const MAX_SIDE = 4000;

export const MAX_KB = 5000;

/**
 * A KB here is 1,000 bytes. A file under N times 1,000 bytes is also under N times 1,024, so the
 * result passes a form whichever way it counts.
 */
export const BYTES_PER_KB = 1000;

/** The JPG qualities tried, from best to smallest. */
export const QUALITY_MAX = 0.95;
export const QUALITY_MIN = 0.05;
/** Halvings of the quality range: enough to land within about 0.004 of the best quality. */
export const SEARCH_STEPS = 8;

export const INPUT_TYPES = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
} as const;

export type ImageType = keyof typeof INPUT_TYPES;

/** How the picture meets a size of another shape. */
export type Fit = "crop" | "pad";

export const FITS = {
  crop: "Crop to fill (cut the edges)",
  pad: "Fit inside (add white bands)",
} as const;

/** What the visitor sets. */
export interface Input {
  width: number;
  height: number;
  maxKb: number;
  fit: Fit;
}

/** What the page sends the worker. */
export interface Job extends Input {
  file: Blob;
}

/** What the worker sends back: the file, or the smallest it could make when that was too big. */
export type JobResult =
  | { met: true; blob: Blob; quality: number }
  | { met: false; smallestBytes: number };

export const MESSAGES = {
  notAnImage: "This file is not a JPG, PNG or WebP image.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  unreadable: "The browser could not read this image. It may be damaged.",
  tooManyPixels: "This image has more than 50 megapixels, more than the browser can hold.",
  side: `Width and height are whole numbers of pixels from 1 to ${MAX_SIDE}.`,
  kb: `The maximum size is a whole number of KB from 1 to ${MAX_KB}.`,
  notMet: (maxKb: number, width: number, height: number, smallest: string) =>
    `A ${width} by ${height} pixel JPG cannot be made under ${maxKb} KB: the smallest this browser can write is ${smallest}. Allow more KB or choose fewer pixels.`,
  failed: "The browser could not resize this image.",
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

export function checkFile(file: { name: string; type: string; size: number }): string | undefined {
  if (!imageTypeOf(file)) return MESSAGES.notAnImage;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return;
}

export function withinPixelLimit(width: number, height: number): boolean {
  return width > 0 && height > 0 && width * height <= MAX_PIXELS;
}

const isWholeIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** The settings, checked: an error to show, or nothing. */
export function checkSettings(
  input: {
    [K in keyof Input]?: Input[K] | undefined;
  },
): string | undefined {
  if (!isWholeIn(input.width, 1, MAX_SIDE) || !isWholeIn(input.height, 1, MAX_SIDE)) {
    return MESSAGES.side;
  }
  if (!isWholeIn(input.maxKb, 1, MAX_KB)) return MESSAGES.kb;
  return;
}

export function targetBytes(maxKb: number): number {
  return maxKb * BYTES_PER_KB;
}

/** Where the picture is drawn on the result, in result pixels. */
export interface Placement {
  /** The part of the source used. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Where it goes on the result. */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** Crop to fill cuts the source to the target shape, centred; Fit inside scales it to fit. */
export function placement(
  source: { width: number; height: number },
  target: { width: number; height: number },
  fit: Fit,
): Placement {
  const sourceRatio = source.width / source.height;
  const targetRatio = target.width / target.height;
  if (fit === "crop") {
    let sw = source.width;
    let sh = source.height;
    if (sourceRatio > targetRatio) sw = source.height * targetRatio;
    else sh = source.width / targetRatio;
    return {
      sx: (source.width - sw) / 2,
      sy: (source.height - sh) / 2,
      sw,
      sh,
      dx: 0,
      dy: 0,
      dw: target.width,
      dh: target.height,
    };
  }
  const scale = Math.min(target.width / source.width, target.height / source.height);
  const dw = source.width * scale;
  const dh = source.height * scale;
  return {
    sx: 0,
    sy: 0,
    sw: source.width,
    sh: source.height,
    dx: (target.width - dw) / 2,
    dy: (target.height - dh) / 2,
    dw,
    dh,
  };
}

/**
 * The best JPG quality whose file is at most `limit` bytes, found by halving the range. `encode`
 * gives the file at a quality. The best quality is tried first, the smallest last; when even the
 * smallest is too big, the result says so with its size, so the page can be honest about it.
 */
export async function findQuality<T extends { size: number }>(
  encode: (quality: number) => Promise<T>,
  limit: number,
  onStep?: (step: number, total: number) => void,
): Promise<{ met: true; file: T; quality: number } | { met: false; smallest: T }> {
  const total = SEARCH_STEPS + 2;
  const best = await encode(QUALITY_MAX);
  onStep?.(1, total);
  if (best.size <= limit) return { met: true, file: best, quality: QUALITY_MAX };
  const smallest = await encode(QUALITY_MIN);
  onStep?.(2, total);
  if (smallest.size > limit) return { met: false, smallest };
  let low = QUALITY_MIN;
  let high = QUALITY_MAX;
  let found = smallest;
  let foundQuality = QUALITY_MIN;
  for (let step = 0; step < SEARCH_STEPS; step++) {
    const middle = (low + high) / 2;
    const file = await encode(middle);
    onStep?.(step + 3, total);
    if (file.size <= limit) {
      low = middle;
      found = file;
      foundQuality = middle;
    } else {
      high = middle;
    }
  }
  return { met: true, file: found, quality: foundQuality };
}

/** `passport.png` at 200 by 230 is `passport-200x230.jpg`. */
export function outputName(inputName: string, width: number, height: number): string {
  const base = inputName.replace(/\.[a-z0-9]{1,5}$/i, "") || "photo";
  return safeFilename(`${base}-${width}x${height}.jpg`, { extension: "jpg", fallback: "photo" });
}

/** Reads a number box: empty or not a number gives nothing. */
export function parseNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return;
  return value;
}

/** Bytes as KB of 1,000 bytes, with the exact count: `18.4 KB (18,431 bytes)`. */
export function formatKb(bytes: number): string {
  return `${(bytes / BYTES_PER_KB).toFixed(1)} KB (${bytes.toLocaleString("en-US")} bytes)`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
