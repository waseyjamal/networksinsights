// Pure logic of "Background Remover": the rules the workspace and the worker follow, and the
// arithmetic around the model, with no DOM, no network and no top-level statements
// (docs/tool-contract.md, "logic.ts: what pure means"). The model runs in worker.ts (ADR 0057).

import { safeFilename } from "@networksinsights/tool-sdk/download";

/** The limits the manifest declares and the page enforces: one source for both. */
export const LIMITS = {
  /** 20 MB per photo. */
  maxInputBytes: 20 * 1024 * 1024,
  maxFiles: 1,
} as const;

/**
 * The most pixels one photo may have: 25 megapixels. The worker holds the photo, the scaled mask
 * and the result at four bytes a pixel each, so this keeps one job near 300 MB of memory.
 */
export const MAX_PIXELS = 25_000_000;

/** U²-Netp looks at a square of this many pixels a side; its mask is scaled back up. */
export const MODEL_SIZE = 320;

/**
 * The bytes the first use downloads, measured from the files the build serves: the U²-Netp model
 * (model/u2netp.onnx) and ONNX Runtime's WebAssembly (onnxruntime-web 1.30.0).
 * scripts/vendored-models.test.ts checks both against the files, so the page cannot drift.
 */
export const DOWNLOAD_BYTES = {
  model: 4_574_861,
  runtime: 14_239_897,
} as const;

/** The file types the tool reads, with the name a visitor knows them by. */
export const INPUT_TYPES = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
} as const;

export type InputType = keyof typeof INPUT_TYPES;

/** What the page sends the worker. `file` crosses to the worker by structured clone. */
export interface Job {
  file: Blob;
}

/** What the worker sends back. */
export interface JobResult {
  blob: Blob;
  width: number;
  height: number;
}

/** The stages the worker reports, as the page shows them. */
export const STAGES = {
  download: "Downloading the model (first use only)",
  start: "Starting the model",
  remove: "Removing the background",
  save: "Making the PNG",
} as const;

/** The messages a visitor may see. Written once, so the page and the tests say the same thing. */
export const MESSAGES = {
  notAnImage: "This file is not a JPG, PNG or WebP image.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  oneAtATime: "Background Remover works on one photo at a time.",
  unreadable: "The browser could not read this image. It may be damaged.",
  tooManyPixels: "This image has more than 25 megapixels. Make it smaller and try again.",
  download: "The model could not be downloaded. Check your connection and try again.",
  failed: "The browser could not remove the background from this image.",
} as const;

/** The input type of a file, from its media type or, when the browser gave none, its extension. */
export function inputTypeOf(file: { name: string; type: string }): InputType | undefined {
  if (file.type in INPUT_TYPES) return file.type as InputType;
  if (file.type !== "") return;
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return;
}

/** The photo the tool takes from what a visitor dropped, or why it takes none. */
export function checkFiles<F extends { name: string; type: string; size: number }>(
  files: readonly F[],
): { file: F; error?: undefined } | { file?: undefined; error: string } {
  const [file] = files;
  if (!file) return { error: MESSAGES.notAnImage };
  if (files.length > LIMITS.maxFiles) return { error: MESSAGES.oneAtATime };
  if (!inputTypeOf(file)) return { error: MESSAGES.notAnImage };
  if (file.size > LIMITS.maxInputBytes) {
    return { error: MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes)) };
  }
  return { file };
}

/** True when an image of this size may be decoded at all. */
export function withinPixelLimit(width: number, height: number): boolean {
  return width > 0 && height > 0 && width * height <= MAX_PIXELS;
}

/** The name of a result: `dog.jpg` is `dog-no-background.png`. */
export function outputName(inputName: string): string {
  const base = inputName.replace(/\.[a-z0-9]{1,5}$/i, "");
  return safeFilename(`${base}-no-background.png`, {
    extension: "png",
    fallback: "image-no-background",
  });
}

/** Bytes as a person reads them, in steps of 1,024: `980 bytes`, `612 KB`, `2.4 MB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** The total first-use download, as the page says it: `18 MB`. */
export function downloadSize(): string {
  return formatSize(DOWNLOAD_BYTES.model + DOWNLOAD_BYTES.runtime);
}

/** ImageNet mean and standard deviation per channel, as U²-Netp was trained with. */
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/**
 * The model's input from a square of RGBA pixels: three planes (red, green, blue) of `size` by
 * `size` floats, each scaled by the brightest value in the picture, then normalised by channel.
 */
export function toTensor(rgba: ArrayLike<number>, size = MODEL_SIZE): Float32Array {
  const pixels = size * size;
  if (rgba.length !== pixels * 4) {
    throw new RangeError(`expected ${pixels * 4} values, got ${rgba.length}`);
  }
  let max = 0;
  for (let i = 0; i < rgba.length; i++) {
    if (i % 4 !== 3 && (rgba[i] ?? 0) > max) max = rgba[i] ?? 0;
  }
  const scale = Math.max(max, 1e-6);
  const out = new Float32Array(pixels * 3);
  for (let p = 0; p < pixels; p++) {
    for (let c = 0; c < 3; c++) {
      out[c * pixels + p] = ((rgba[p * 4 + c] ?? 0) / scale - (MEAN[c] ?? 0)) / (STD[c] ?? 1);
    }
  }
  return out;
}

/**
 * The model's output as an opaque grey picture of RGBA pixels: the prediction is stretched to
 * 0 to 255 between its lowest and highest value, white where the subject is.
 */
export function maskToRgba(prediction: ArrayLike<number>): Uint8ClampedArray<ArrayBuffer> {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < prediction.length; i++) {
    const value = prediction[i] ?? 0;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = max - min;
  const out = new Uint8ClampedArray(prediction.length * 4);
  for (let i = 0; i < prediction.length; i++) {
    const grey = range > 0 ? (((prediction[i] ?? 0) - min) / range) * 255 : 0;
    out[i * 4] = grey;
    out[i * 4 + 1] = grey;
    out[i * 4 + 2] = grey;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Writes the red channel of a mask, scaled to the photo's size, into the photo's alpha channel. */
export function applyMask(photo: Uint8ClampedArray, mask: ArrayLike<number>): Uint8ClampedArray {
  if (photo.length !== mask.length) {
    throw new RangeError("the mask and the photo must have the same size");
  }
  for (let i = 3; i < photo.length; i += 4) {
    photo[i] = Math.min(photo[i] ?? 0, mask[i - 3] ?? 0);
  }
  return photo;
}

/** Whole percent of a download, from 0 to 100. */
export function percentOf(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((done / total) * 100)));
}
