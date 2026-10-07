// Pure logic of "Image Upscaler": the file and size rules, the device's pixel limit, the tiles the
// picture is cut into, and the conversion between pixels and the model's tensors, with no DOM, no
// network and no top-level statements (docs/tool-contract.md, "logic.ts: what pure means").
// worker.ts runs Real-ESRGAN (realesr-general-x4v3) with ONNX Runtime Web on each tile (ADR 0066).

import { safeFilename } from "@networksinsights/tool-sdk/download";

/** How many times wider and taller the result is. Fixed by the model. */
export const SCALE = 4;

/**
 * The side of the square each tile keeps, in input pixels. Each tile is run with HALO extra pixels
 * of the picture around it, which the model sees but the result drops.
 */
export const TILE = 192;

/**
 * The model is 34 layers of 3 × 3 convolutions, so an output pixel depends on input pixels at most
 * 34 away. With that much context around every tile, the stitched result is the same as running
 * the whole picture at once: no seams.
 */
export const HALO = 34;

export const LIMITS = {
  /** 30 MB per file. */
  maxInputBytes: 30 * 1024 * 1024,
  /** 1 megapixel in, so at most 16 megapixels out. */
  desktopPixels: 1_000_000,
  /** Half that on a phone or a device that reports 4 GB of memory or less. */
  phonePixels: 500_000,
} as const;

/** The largest result, in pixels: the most a phone's browser (Safari on iPhone) can draw. */
export const MAX_OUTPUT_PIXELS = 16_000_000;

/** The model and the engine, served from this site (ADR 0066). Kept in step by a test. */
export const MODEL = {
  url: "/models/realesr-general-x4v3/1793a6e7fdf15a53/model.onnx",
  sha256: "1793a6e7fdf15a53eed213ba269ea768b5373858ae433d56ee8e1b0424377cc5",
  bytes: 4_866_413,
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

/** What the page knows about the device, for the pixel limit. */
export interface Device {
  /** The main pointer is a finger: `(pointer: coarse)`. */
  touchPrimary: boolean;
  /** `navigator.deviceMemory` in GB. Chrome and Edge only: Safari and Firefox leave it out. */
  deviceMemory?: number | undefined;
}

/** What the page sends the worker. */
export interface Job {
  file: Blob;
  device: Device;
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
  tooManyPixels: (width: number, height: number, limit: number) =>
    `This picture is ${width.toLocaleString("en-US")} × ${height.toLocaleString("en-US")} pixels. On this device the upscaler takes at most ${(limit / 1_000_000).toLocaleString("en-US")} megapixels. Make it smaller first, for example with Resize Image.`,
  outOfMemory: "This image is too large for this device's memory. Try a smaller image.",
  unreadable: "This picture could not be read. It may be damaged.",
  modelFailed: "The upscaling model could not be loaded. Check your connection, then try again.",
  failed: "The picture could not be upscaled.",
} as const;

/** A phone, or a device that says it has 4 GB of memory or less. No value is not a phone. */
export function isSmallDevice(device: Device): boolean {
  return (
    device.touchPrimary || (typeof device.deviceMemory === "number" && device.deviceMemory <= 4)
  );
}

export function pixelLimit(device: Device): number {
  return isSmallDevice(device) ? LIMITS.phonePixels : LIMITS.desktopPixels;
}

/** Null when the picture fits, or the message to show. */
export function checkPixels(width: number, height: number, device: Device): string | null {
  const limit = pixelLimit(device);
  if (width < 1 || height < 1) return MESSAGES.unreadable;
  if (width * height > limit || width * height * SCALE * SCALE > MAX_OUTPUT_PIXELS) {
    return MESSAGES.tooManyPixels(width, height, limit);
  }
  return null;
}

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

/** One tile: the part it keeps, and the larger part the model sees. Input pixels. */
export interface Tile {
  x: number;
  y: number;
  width: number;
  height: number;
  inX: number;
  inY: number;
  inWidth: number;
  inHeight: number;
}

/** Cuts the picture into tiles of at most `tile` pixels a side, each with `halo` pixels around it. */
export function planTiles(width: number, height: number, tile = TILE, halo = HALO): Tile[] {
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y += tile) {
    for (let x = 0; x < width; x += tile) {
      const w = Math.min(tile, width - x);
      const h = Math.min(tile, height - y);
      const inX = Math.max(0, x - halo);
      const inY = Math.max(0, y - halo);
      const inRight = Math.min(width, x + w + halo);
      const inBottom = Math.min(height, y + h + halo);
      tiles.push({
        x,
        y,
        width: w,
        height: h,
        inX,
        inY,
        inWidth: inRight - inX,
        inHeight: inBottom - inY,
      });
    }
  }
  return tiles;
}

/** The tile's pixels as the model takes them: RGB planes, 0 to 1, shape [1, 3, inHeight, inWidth]. */
export function tileTensor(rgba: Uint8ClampedArray, imageWidth: number, tile: Tile): Float32Array {
  const plane = tile.inWidth * tile.inHeight;
  const out = new Float32Array(3 * plane);
  for (let row = 0; row < tile.inHeight; row++) {
    const source = ((tile.inY + row) * imageWidth + tile.inX) * 4;
    for (let col = 0; col < tile.inWidth; col++) {
      const i = source + col * 4;
      const o = row * tile.inWidth + col;
      out[o] = (rgba[i] ?? 0) / 255;
      out[plane + o] = (rgba[i + 1] ?? 0) / 255;
      out[2 * plane + o] = (rgba[i + 2] ?? 0) / 255;
    }
  }
  return out;
}

/**
 * Copies the part of the model's output that the tile keeps into the result, rounding to 8 bits.
 * `output` has shape [1, 3, inHeight × SCALE, inWidth × SCALE]. Alpha is left to `scaleAlpha`.
 */
export function writeTile(
  result: Uint8ClampedArray,
  resultWidth: number,
  tile: Tile,
  output: Float32Array,
): void {
  const outWidth = tile.inWidth * SCALE;
  const plane = outWidth * tile.inHeight * SCALE;
  const offsetX = (tile.x - tile.inX) * SCALE;
  const offsetY = (tile.y - tile.inY) * SCALE;
  for (let row = 0; row < tile.height * SCALE; row++) {
    const target = ((tile.y * SCALE + row) * resultWidth + tile.x * SCALE) * 4;
    const source = (offsetY + row) * outWidth + offsetX;
    for (let col = 0; col < tile.width * SCALE; col++) {
      const t = target + col * 4;
      const s = source + col;
      result[t] = Math.round((output[s] ?? 0) * 255);
      result[t + 1] = Math.round((output[plane + s] ?? 0) * 255);
      result[t + 2] = Math.round((output[2 * plane + s] ?? 0) * 255);
    }
  }
}

/**
 * The alpha of the result: each source pixel's alpha repeated over its SCALE × SCALE block. The
 * model sees colour only, so transparency is kept as it was, not sharpened.
 */
export function scaleAlpha(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  result: Uint8ClampedArray,
): void {
  const resultWidth = width * SCALE;
  for (let y = 0; y < height * SCALE; y++) {
    const from = Math.floor(y / SCALE) * width;
    for (let x = 0; x < resultWidth; x++) {
      result[(y * resultWidth + x) * 4 + 3] = source[(from + Math.floor(x / SCALE)) * 4 + 3] ?? 255;
    }
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
  return safeFilename(`${base}-4x.png`);
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** The number of tiles, for progress. */
export function tileCount(width: number, height: number): number {
  return Math.ceil(width / TILE) * Math.ceil(height / TILE);
}
