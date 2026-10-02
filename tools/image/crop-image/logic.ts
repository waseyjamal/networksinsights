// Pure logic of "Crop Image": the crop rectangle and its rules, with no DOM, no network and no
// top-level statements (docs/tool-contract.md, "logic.ts: what pure means"). The pixels are cut
// in ui.tsx, on a canvas, by the browser.

import { safeFilename } from "@networksinsights/tool-sdk/download";

export const LIMITS = {
  /** 25 MB, one picture at a time. */
  maxInputBytes: 25 * 1024 * 1024,
  maxFiles: 1,
} as const;

/** The largest picture read: 50 megapixels, under 200 MB of memory decoded. */
export const MAX_PIXELS = 50_000_000;

export const INPUT_TYPES = {
  "image/jpeg": { label: "JPG", extension: "jpg" },
  "image/png": { label: "PNG", extension: "png" },
  "image/webp": { label: "WebP", extension: "webp" },
} as const;

export type ImageType = keyof typeof INPUT_TYPES;

/** The shapes offered. `free` lets both sides be set on their own. */
export const RATIOS = {
  free: { label: "Free", value: 0 },
  "1:1": { label: "Square (1:1)", value: 1 },
  "4:3": { label: "4:3", value: 4 / 3 },
  "3:4": { label: "3:4", value: 3 / 4 },
  "3:2": { label: "3:2", value: 3 / 2 },
  "2:3": { label: "2:3", value: 2 / 3 },
  "16:9": { label: "16:9", value: 16 / 9 },
  "9:16": { label: "9:16", value: 9 / 16 },
} as const;

export type Ratio = keyof typeof RATIOS;

export interface Size {
  width: number;
  height: number;
}

/** A crop in pixels of the original: left and top edge, width and height. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Kept for the manifest's input schema. */
export interface Input extends Rect {
  ratio: Ratio;
}

export const MESSAGES = {
  notAnImage: "This file is not a JPG, PNG or WebP image.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  unreadable: "The browser could not read this image. It may be damaged.",
  tooManyPixels: "This image has more than 50 megapixels, more than the browser can hold.",
  wholePixels:
    "Every box takes a whole number of pixels: 0 or more for Left and Top, 1 or more for Width and Height.",
  outside: (size: Size) =>
    `The crop must fit inside the picture, which is ${size.width} by ${size.height} pixels.`,
  failed: "The browser could not crop this image.",
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

/** The largest crop of a ratio that fits the picture, centred. Free is the whole picture. */
export function largestCrop(image: Size, ratio: Ratio): Rect {
  const value = RATIOS[ratio].value;
  if (value === 0) return { x: 0, y: 0, width: image.width, height: image.height };
  let width = image.width;
  let height = Math.round(width / value);
  if (height > image.height) {
    height = image.height;
    width = Math.round(height * value);
  }
  width = Math.max(1, Math.min(width, image.width));
  height = Math.max(1, Math.min(height, image.height));
  return {
    x: Math.floor((image.width - width) / 2),
    y: Math.floor((image.height - height) / 2),
    width,
    height,
  };
}

/** With a fixed ratio, the height that goes with a width, and the reverse. */
export function heightFor(width: number, ratio: Ratio): number | undefined {
  const value = RATIOS[ratio].value;
  if (value === 0) return;
  return Math.max(1, Math.round(width / value));
}

export function widthFor(height: number, ratio: Ratio): number | undefined {
  const value = RATIOS[ratio].value;
  if (value === 0) return;
  return Math.max(1, Math.round(height * value));
}

const isWhole = (value: unknown, min: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min;

/** A crop the picture can give, or why not. */
export function checkCrop(
  rect: Partial<Record<keyof Rect, number | undefined>>,
  image: Size,
): { ok: true; rect: Rect } | { ok: false; error: string } {
  const { x, y, width, height } = rect;
  if (!isWhole(x, 0) || !isWhole(y, 0) || !isWhole(width, 1) || !isWhole(height, 1)) {
    return { ok: false, error: MESSAGES.wholePixels };
  }
  if (x + width > image.width || y + height > image.height) {
    return { ok: false, error: MESSAGES.outside(image) };
  }
  return { ok: true, rect: { x, y, width, height } };
}

/** The format of the result: the input's own, or PNG where the browser cannot write it. */
export function outputType(input: ImageType, writable: readonly ImageType[]): ImageType {
  return writable.includes(input) ? input : "image/png";
}

/** `photo.jpg` cut to 800 by 800 is `photo-cropped-800x800.jpg`. */
export function outputName(inputName: string, rect: Rect, type: ImageType): string {
  const base = inputName.replace(/\.[a-z0-9]{1,5}$/i, "") || "image";
  const { extension } = INPUT_TYPES[type];
  return safeFilename(`${base}-cropped-${rect.width}x${rect.height}.${extension}`, {
    extension,
    fallback: "image-cropped",
  });
}

export function qualityFor(type: ImageType): number | undefined {
  if (type === "image/png") return;
  return 0.92;
}

/** Reads a number box: empty or not a number gives nothing. */
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
