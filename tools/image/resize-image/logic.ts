// Pure logic of "Resize Image": the size rules the workspace follows, with no DOM, no network and
// no top-level statements (docs/tool-contract.md, "logic.ts: what pure means"). The pixels are
// drawn in ui.tsx, on a canvas, by the browser.

import { safeFilename } from "@networksinsights/tool-sdk/download";

export const LIMITS = {
  /** 25 MB, one picture at a time. */
  maxInputBytes: 25 * 1024 * 1024,
  maxFiles: 1,
} as const;

/** The largest picture read or written: 50 megapixels, under 200 MB of memory decoded. */
export const MAX_PIXELS = 50_000_000;

/** The longest side written. Browsers refuse larger canvases. */
export const MAX_SIDE = 16_384;

export const MAX_PERCENT = 1000;

export const INPUT_TYPES = {
  "image/jpeg": { label: "JPG", extension: "jpg" },
  "image/png": { label: "PNG", extension: "png" },
  "image/webp": { label: "WebP", extension: "webp" },
} as const;

export type ImageType = keyof typeof INPUT_TYPES;

export type Mode = "pixels" | "percent";

/** What the visitor sets. Empty boxes are `undefined`. */
export interface Input {
  mode: Mode;
  width?: number | undefined;
  height?: number | undefined;
  keepRatio: boolean;
  percent?: number | undefined;
}

export interface Size {
  width: number;
  height: number;
}

export type SizeResult = { ok: true; size: Size } | { ok: false; error: string };

export const MESSAGES = {
  notAnImage: "This file is not a JPG, PNG or WebP image.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  unreadable: "The browser could not read this image. It may be damaged.",
  tooManyPixels: "This image has more than 50 megapixels, more than the browser can hold.",
  needSize: "Enter a width or a height.",
  needBoth: "Enter both a width and a height, or turn Keep proportions on.",
  wholePixels: "Width and height are whole numbers of pixels, 1 or more.",
  percentRange: `Enter a percentage from 1 to ${MAX_PERCENT}.`,
  tooBig: "The new size is too large: at most 16,384 pixels a side and 50 megapixels in all.",
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

/** Why a file cannot be used, or nothing when it can. */
export function checkFile(file: { name: string; type: string; size: number }): string | undefined {
  if (!imageTypeOf(file)) return MESSAGES.notAnImage;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return;
}

export function withinPixelLimit(width: number, height: number): boolean {
  return width > 0 && height > 0 && width * height <= MAX_PIXELS;
}

const isNumber = (value: unknown): value is number => typeof value === "number";

const isWhole = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value) && value >= 1;

/** The new size from the visitor's settings and the original size. */
export function targetSize(input: Input, original: Size): SizeResult {
  let width: number;
  let height: number;
  if (input.mode === "percent") {
    const percent = input.percent;
    if (!isNumber(percent) || !(percent >= 1 && percent <= MAX_PERCENT)) {
      return { ok: false, error: MESSAGES.percentRange };
    }
    width = Math.max(1, Math.round((original.width * percent) / 100));
    height = Math.max(1, Math.round((original.height * percent) / 100));
  } else {
    const { width: w, height: h } = input;
    if (!isNumber(w) && !isNumber(h)) return { ok: false, error: MESSAGES.needSize };
    if ((isNumber(w) && !isWhole(w)) || (isNumber(h) && !isWhole(h))) {
      return { ok: false, error: MESSAGES.wholePixels };
    }
    if (input.keepRatio) {
      if (isNumber(w)) {
        width = w;
        height = Math.max(1, Math.round((w * original.height) / original.width));
      } else {
        height = h as number;
        width = Math.max(1, Math.round(((h as number) * original.width) / original.height));
      }
    } else {
      if (!isNumber(w) || !isNumber(h)) return { ok: false, error: MESSAGES.needBoth };
      width = w;
      height = h;
    }
  }
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    return { ok: false, error: MESSAGES.tooBig };
  }
  return { ok: true, size: { width, height } };
}

/**
 * The format the result is written in: the input's own, unless the browser cannot write it
 * (WebP in Safari), when PNG keeps every pixel and any transparency.
 */
export function outputType(input: ImageType, writable: readonly ImageType[]): ImageType {
  return writable.includes(input) ? input : "image/png";
}

/** `photo.jpg` at 800 by 600 is `photo-800x600.jpg`. */
export function outputName(inputName: string, size: Size, type: ImageType): string {
  const base = inputName.replace(/\.[a-z0-9]{1,5}$/i, "") || "image";
  const { extension } = INPUT_TYPES[type];
  return safeFilename(`${base}-${size.width}x${size.height}.${extension}`, {
    extension,
    fallback: "image-resized",
  });
}

/** The encoder quality for a type; PNG is lossless and takes none. */
export function qualityFor(type: ImageType): number | undefined {
  if (type === "image/png") return;
  return 0.92;
}

/** Reads a number box: empty or not a number is `undefined`. */
export function parseNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return;
  return value;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
