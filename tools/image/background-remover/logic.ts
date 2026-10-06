// Pure logic of "Background Remover": the file and size rules, the size the model works at, the
// conversion between pixels and the model's tensors, and the matte scaled back to the picture,
// with no DOM, no network and no top-level statements (docs/tool-contract.md, "logic.ts: what
// pure means"). worker.ts runs MODNet, a portrait matting model, with ONNX Runtime Web (ADR 0066).

import { safeFilename } from "@networksinsights/tool-sdk/download";

/** The model sees the picture with its shorter side at this many pixels. */
export const MODEL_SIDE = 512;

/** The longer side the model sees is at most this, so a long strip cannot fill the memory. */
export const MODEL_MAX_SIDE = 2048;

/** Both sides the model sees are a multiple of this. */
export const MODEL_STEP = 32;

export const LIMITS = {
  /** 30 MB per file. */
  maxInputBytes: 30 * 1024 * 1024,
  /** 24 megapixels in: the picture, its matte and the result stay near 300 MB of memory. */
  maxPixels: 24_000_000,
} as const;

/** The model and the engine, served from this site (ADR 0066). Kept in step by a test. */
export const MODEL = {
  url: "/models/modnet/7bad6522b3cde602/model.onnx",
  sha256: "7bad6522b3cde60246e69e234b7786337ef9c88abc790ee5c1aaa6e535b0c61d",
  bytes: 6_627_048,
} as const;

export const ENGINE = {
  base: "/vendor/onnxruntime-web/1.30.0/",
  mjs: "ort-wasm-simd-threaded.mjs",
  wasm: "ort-wasm-simd-threaded.wasm",
  /** Both files together, as served. */
  bytes: 14_264_278,
} as const;

/** Kept for the manifest's input schema: the visitor makes no choice but the picture. */
export type Input = Record<string, never>;

/** What the page sends the worker. */
export interface Job {
  file: Blob;
}

export interface JobResult {
  blob: Blob;
  width: number;
  height: number;
}

export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const MESSAGES = {
  notImage: "This file is not a JPG, PNG or WebP picture.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooManyPixels: (width: number, height: number) =>
    `This picture is ${width.toLocaleString("en-US")} × ${height.toLocaleString("en-US")} pixels, more than the ${LIMITS.maxPixels / 1_000_000} megapixels this tool can hold in memory.`,
  outOfMemory: "This image is too large for this device's memory. Try a smaller image.",
  unreadable: "This picture could not be read. It may be damaged.",
  modelFailed: "The model could not be loaded. Check your connection, then try again.",
  failed: "The background could not be removed.",
} as const;

/** Null when the file can be tried, or why not. */
export function checkFile(file: { name: string; type: string; size: number }): string | null {
  const type = file.type.toLowerCase();
  const byName = /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!(ACCEPTED_TYPES as readonly string[]).includes(type) && !(type === "" && byName)) {
    return MESSAGES.notImage;
  }
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return null;
}

/** Null when the picture fits, or the message to show. */
export function checkPixels(width: number, height: number): string | null {
  if (width < 1 || height < 1) return MESSAGES.unreadable;
  if (width * height > LIMITS.maxPixels) return MESSAGES.tooManyPixels(width, height);
  return null;
}

/**
 * The size the model sees, as the published model's preprocessing config sets it: the shorter side
 * becomes 512, the other keeps the proportion, and each is rounded down to a multiple of 32. A
 * picture more than four times longer than wide is scaled so its longer side is 2048 instead.
 */
export function modelSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(
    MODEL_SIDE / Math.min(width, height),
    MODEL_MAX_SIDE / Math.max(width, height),
  );
  const round = (side: number) =>
    Math.max(MODEL_STEP, Math.floor((side * scale) / MODEL_STEP) * MODEL_STEP);
  return { width: round(width), height: round(height) };
}

/** The picture as the model takes it: RGB planes scaled to -1 to 1, shape [1, 3, height, width]. */
export function modelTensor(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const plane = width * height;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    out[i] = (rgba[i * 4] ?? 0) / 127.5 - 1;
    out[plane + i] = (rgba[i * 4 + 1] ?? 0) / 127.5 - 1;
    out[2 * plane + i] = (rgba[i * 4 + 2] ?? 0) / 127.5 - 1;
  }
  return out;
}

/**
 * The matte (0 to 1, the model's size) scaled to the picture's size with bilinear sampling, as
 * 8-bit alpha. Pixel centres line up, as a browser's canvas scales.
 */
export function scaleMatte(
  matte: Float32Array,
  matteWidth: number,
  matteHeight: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(width * height);
  const sx = matteWidth / width;
  const sy = matteHeight / height;
  const at = (x: number, y: number) => matte[y * matteWidth + x] ?? 0;
  for (let y = 0; y < height; y++) {
    const fy = Math.min(Math.max((y + 0.5) * sy - 0.5, 0), matteHeight - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, matteHeight - 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(Math.max((x + 0.5) * sx - 0.5, 0), matteWidth - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, matteWidth - 1);
      const wx = fx - x0;
      const top = at(x0, y0) * (1 - wx) + at(x1, y0) * wx;
      const bottom = at(x0, y1) * (1 - wx) + at(x1, y1) * wx;
      alpha[y * width + x] = Math.round((top * (1 - wy) + bottom * wy) * 255);
    }
  }
  return alpha;
}

/** Sets the picture's alpha to the matte, keeping any transparency it already had. */
export function applyAlpha(rgba: Uint8ClampedArray, alpha: Uint8ClampedArray): void {
  for (let i = 0; i < alpha.length; i++) {
    const own = rgba[i * 4 + 3] ?? 255;
    rgba[i * 4 + 3] = Math.round(((alpha[i] ?? 0) * own) / 255);
  }
}

/** True when the error is the browser or the engine running out of memory. */
export function isOutOfMemory(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /out of memory|memory access out of bounds|cannot allocate|failed to allocate|allocation fail|could not allocate|Array buffer allocation|OOM|bad_alloc/i.test(
    text,
  );
}

/** Lowercase hex of a digest. */
export function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function outputName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "picture";
  return safeFilename(`${base}-no-background.png`);
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}
