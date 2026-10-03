// Pure logic of "HEIC to JPG": the file rules, the size of a photo read from its HEIF boxes before
// anything is decoded, the output names and the alpha flattening for JPG, with no DOM, no network
// and no top-level statements (docs/tool-contract.md, "logic.ts: what pure means"). worker.ts
// decodes the photo with libheif (ADR 0060).

import { safeFilename } from "@networksinsights/tool-sdk/download";

/** The limits the manifest declares and the page enforces: one source for both. */
export const LIMITS = {
  /** 50 MB per file. */
  maxInputBytes: 50 * 1024 * 1024,
  maxFiles: 20,
} as const;

/**
 * The most pixels one photo may have: 50 megapixels, so a 48 megapixel iPhone photo fits. Decoded,
 * a photo takes four bytes a pixel, so this keeps one photo near 200 MB of memory.
 */
export const MAX_PIXELS = 50_000_000;

/** libheif's WebAssembly, served unmodified from this site (ADR 0060). Keep in step with libheif-js. */
export const LIBHEIF_ASSETS = "/vendor/libheif/1.23.2/";

export const OUTPUT_FORMATS = {
  jpg: { mime: "image/jpeg", label: "JPG", extension: "jpg" },
  png: { mime: "image/png", label: "PNG", extension: "png" },
} as const;

export type OutputFormat = keyof typeof OUTPUT_FORMATS;

export const QUALITIES = {
  high: { label: "High (92%)", value: 0.92 },
  balanced: { label: "Balanced (80%)", value: 0.8 },
  small: { label: "Smallest (60%)", value: 0.6 },
} as const;

export type Quality = keyof typeof QUALITIES;

/** Kept for the manifest's input schema: the choices a visitor makes. */
export interface Input {
  format: OutputFormat;
  quality: Quality;
}

/** What the page sends the worker. */
export interface Job {
  file: Blob;
  format: OutputFormat;
  quality: Quality;
}

export interface JobResult {
  blob: Blob;
  width: number;
  height: number;
}

export const MESSAGES = {
  notHeic: "This file is not a HEIC or HEIF photo.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooManyFiles: (count: number) => `Only ${count} files can be converted at once.`,
  tooManyPixels: (width: number, height: number) =>
    `This photo is ${width.toLocaleString("en-US")} × ${height.toLocaleString("en-US")} pixels, more than the ${MAX_PIXELS / 1_000_000} megapixels this tool can hold in memory.`,
  unreadable:
    "This photo could not be read. It may be damaged, or use a kind of HEIF this tool cannot decode.",
  failed: "The browser could not write the picture.",
} as const;

const MEDIA_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

/** HEIC or HEIF by media type or, when the browser gave none or a generic one, by extension. */
export function isHeicFile(file: { name: string; type: string }): boolean {
  if (MEDIA_TYPES.has(file.type.toLowerCase())) return true;
  if (file.type !== "" && file.type !== "application/octet-stream") return false;
  return /\.(heic|heif|hif)$/i.test(file.name);
}

export interface Rejected {
  name: string;
  reason: string;
}

/** Splits added files into the ones taken and the ones refused, never more than the file limit. */
export function checkFiles<F extends { name: string; type: string; size: number }>(
  files: readonly F[],
  already = 0,
): { accepted: F[]; rejected: Rejected[] } {
  const accepted: F[] = [];
  const rejected: Rejected[] = [];
  for (const file of files) {
    if (!isHeicFile(file)) {
      rejected.push({ name: file.name, reason: MESSAGES.notHeic });
    } else if (file.size > LIMITS.maxInputBytes) {
      rejected.push({
        name: file.name,
        reason: MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes)),
      });
    } else if (already + accepted.length >= LIMITS.maxFiles) {
      rejected.push({ name: file.name, reason: MESSAGES.tooManyFiles(LIMITS.maxFiles) });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}

/** The ftyp brands of HEIF still images and sequences coded with HEVC. AVIF is not among them. */
const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
  "mif2",
]);

interface Box {
  type: string;
  /** Where the box's content starts, after its header. */
  start: number;
  end: number;
}

function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(
    bytes[at] ?? 0,
    bytes[at + 1] ?? 0,
    bytes[at + 2] ?? 0,
    bytes[at + 3] ?? 0,
  );
}

function u16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function u32(bytes: Uint8Array, at: number): number {
  return (
    (((bytes[at] ?? 0) << 24) >>> 0) +
    (((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0))
  );
}

/** The boxes between `from` and `to`. Stops at the first box whose size does not fit. */
function boxes(bytes: Uint8Array, from: number, to: number): Box[] {
  const found: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = u32(bytes, at);
    const type = fourcc(bytes, at + 4);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) break;
      const high = u32(bytes, at + 8);
      if (high !== 0) break;
      size = u32(bytes, at + 12);
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) break;
    found.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return found;
}

const child = (bytes: Uint8Array, parent: Box, type: string, skip = 0) =>
  boxes(bytes, parent.start + skip, parent.end).find((box) => box.type === type);

export type HeifInfo =
  | { ok: true; width: number; height: number }
  | { ok: false; reason: "not-heif" | "no-size" };

/**
 * The size of a HEIF file's primary image, as it is shown (a 90 or 270 degree `irot` swaps the
 * sides), read from its boxes: `ftyp`, then `meta` with `pitm`, `iprp/ipco` and `ipma`, whose
 * `ispe` property holds the size. Nothing is decoded, so a photo too large to hold in memory is
 * refused before it is.
 */
export function readHeifInfo(bytes: Uint8Array): HeifInfo {
  const top = boxes(bytes, 0, bytes.length);
  const ftyp = top[0];
  if (ftyp?.type !== "ftyp" || ftyp.end - ftyp.start < 8) {
    return { ok: false, reason: "not-heif" };
  }
  const brands = [fourcc(bytes, ftyp.start)];
  for (let at = ftyp.start + 8; at + 4 <= ftyp.end; at += 4) brands.push(fourcc(bytes, at));
  const major = brands[0] ?? "";
  if (major === "avif" || major === "avis" || !brands.some((brand) => HEIF_BRANDS.has(brand))) {
    return { ok: false, reason: "not-heif" };
  }

  const meta = top.find((box) => box.type === "meta");
  if (!meta) return { ok: false, reason: "no-size" };
  // meta, pitm and ipma are full boxes: a version byte and three flag bytes come first.
  const pitm = child(bytes, meta, "pitm", 4);
  const iprp = child(bytes, meta, "iprp", 4);
  if (!pitm || !iprp) return { ok: false, reason: "no-size" };
  const primary = bytes[pitm.start] === 0 ? u16(bytes, pitm.start + 4) : u32(bytes, pitm.start + 4);
  const ipco = child(bytes, iprp, "ipco");
  const ipma = child(bytes, iprp, "ipma");
  if (!ipco || !ipma) return { ok: false, reason: "no-size" };
  const properties = boxes(bytes, ipco.start, ipco.end);

  const version = bytes[ipma.start] ?? 0;
  const wideIndex = ((bytes[ipma.start + 3] ?? 0) & 1) === 1;
  const entries = u32(bytes, ipma.start + 4);
  let at = ipma.start + 8;
  let associated: number[] | undefined;
  for (let entry = 0; entry < entries && at < ipma.end; entry++) {
    const item = version < 1 ? u16(bytes, at) : u32(bytes, at);
    at += version < 1 ? 2 : 4;
    const count = bytes[at] ?? 0;
    at += 1;
    const indexes: number[] = [];
    for (let index = 0; index < count; index++) {
      indexes.push(wideIndex ? u16(bytes, at) & 0x7fff : (bytes[at] ?? 0) & 0x7f);
      at += wideIndex ? 2 : 1;
    }
    if (item === primary) associated = indexes;
  }
  if (!associated) return { ok: false, reason: "no-size" };

  let width = 0;
  let height = 0;
  let turned = false;
  for (const index of associated) {
    // Property indexes start at 1; 0 means none.
    const property = properties[index - 1];
    if (property?.type === "ispe") {
      width = u32(bytes, property.start + 4);
      height = u32(bytes, property.start + 8);
    } else if (property?.type === "irot") {
      turned = ((bytes[property.start] ?? 0) & 3) % 2 === 1;
    }
  }
  if (width <= 0 || height <= 0) return { ok: false, reason: "no-size" };
  return turned ? { ok: true, width: height, height: width } : { ok: true, width, height };
}

/** True when a photo of this size may be decoded. Exactly 50 megapixels is allowed. */
export function withinPixelLimit(width: number, height: number): boolean {
  return width > 0 && height > 0 && width * height <= MAX_PIXELS;
}

/**
 * Lays RGBA pixels on white, in place, and makes them opaque: JPG has no transparency, and a
 * transparent pixel would otherwise turn black.
 */
export function flattenOnWhite(data: Uint8ClampedArray): void {
  for (let at = 0; at < data.length; at += 4) {
    const alpha = data[at + 3] ?? 255;
    if (alpha === 255) continue;
    const keep = alpha / 255;
    for (let channel = 0; channel < 3; channel++) {
      data[at + channel] = Math.round((data[at + channel] ?? 0) * keep + 255 * (1 - keep));
    }
    data[at + 3] = 255;
  }
}

/** `IMG_0420.HEIC` as JPG is `IMG_0420.jpg`. */
export function outputName(inputName: string, format: OutputFormat): string {
  const base = inputName.replace(/\.(heic|heif|hif)$/i, "").trim() || "photo";
  const { extension } = OUTPUT_FORMATS[format];
  return safeFilename(`${base}.${extension}`, { extension, fallback: "photo" });
}

/** Bytes as a person reads them, in steps of 1,024: `980 bytes`, `612 KB`, `2.4 MB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
