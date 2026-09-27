// Pure logic of "Compress Image": the rules the workspace and the worker follow, with no DOM, no
// network and no top-level statements (docs/tool-contract.md, "logic.ts: what pure means").
// The pixels are handled in worker.ts, with the browser's own decoder and encoder.

import { safeFilename } from "@networksinsights/tool-sdk/download";

/** The limits the manifest declares and the page enforces: one source for both. */
export const LIMITS = {
  /** 25 MB per file. */
  maxInputBytes: 25 * 1024 * 1024,
  maxFiles: 20,
} as const;

/**
 * The most pixels one image may have: 50 megapixels. A decoded image takes four bytes a pixel, so
 * this keeps one image under 200 MB of memory, which every supported browser can hold.
 */
export const MAX_PIXELS = 50_000_000;

/** The file types the tool reads, with the name a visitor knows them by. */
export const INPUT_TYPES = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
} as const;

export type InputType = keyof typeof INPUT_TYPES;

/** The formats the tool writes. */
export const OUTPUT_FORMATS = {
  jpg: { mime: "image/jpeg", label: "JPG", extension: "jpg" },
  webp: { mime: "image/webp", label: "WebP", extension: "webp" },
} as const;

export type OutputFormat = keyof typeof OUTPUT_FORMATS;

/** The quality levels offered, as the encoder's 0 to 1 quality. */
export const QUALITY_LEVELS = {
  high: { label: "High (90%)", value: 0.9 },
  balanced: { label: "Balanced (75%)", value: 0.75 },
  small: { label: "Smallest (60%)", value: 0.6 },
} as const;

export type QualityLevel = keyof typeof QUALITY_LEVELS;

/** What the page sends the worker. `file` crosses to the worker by structured clone. */
export interface Job {
  file: Blob;
  format: OutputFormat;
  quality: QualityLevel;
}

/** What the worker sends back. */
export interface JobResult {
  blob: Blob;
  width: number;
  height: number;
}

/** Kept for the manifest's input schema: the choices a visitor makes. */
export interface Input {
  format: OutputFormat;
  quality: QualityLevel;
}

/** The messages a visitor may see. Written once, so the page and the tests say the same thing. */
export const MESSAGES = {
  notAnImage: "This file is not a JPG, PNG or WebP image.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooManyFiles: (count: number) => `Only ${count} files can be compressed at once.`,
  unreadable: "The browser could not read this image. It may be damaged.",
  tooManyPixels: "This image has more pixels than the browser can hold in memory.",
  formatUnavailable: (format: string) => `This browser cannot write ${format} files.`,
  failed: "The browser could not compress this image.",
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

export interface Rejected {
  name: string;
  reason: string;
}

/**
 * Splits the files a visitor added into the ones the tool takes and the ones it refuses, with the
 * reason. `already` is how many files are in the list; the total never passes the file limit.
 */
export function checkFiles<F extends { name: string; type: string; size: number }>(
  files: readonly F[],
  already = 0,
): { accepted: F[]; rejected: Rejected[] } {
  const accepted: F[] = [];
  const rejected: Rejected[] = [];
  for (const file of files) {
    if (!inputTypeOf(file)) {
      rejected.push({ name: file.name, reason: MESSAGES.notAnImage });
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

/** The name of a result: `holiday photo.png` as WebP is `holiday photo-compressed.webp`. */
export function outputName(inputName: string, format: OutputFormat): string {
  const base = inputName.replace(/\.[a-z0-9]{1,5}$/i, "");
  const { extension } = OUTPUT_FORMATS[format];
  return safeFilename(`${base}-compressed.${extension}`, {
    extension,
    fallback: "image-compressed",
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

export interface Saving {
  before: number;
  after: number;
  /** Bytes saved; negative when the result is larger. */
  saved: number;
  /** Whole percent saved, rounded toward zero; negative when the result is larger. */
  percent: number;
  larger: boolean;
}

/** How much smaller the result is. */
export function saving(before: number, after: number): Saving {
  const saved = before - after;
  const percent = before > 0 ? Math.trunc((saved / before) * 100) : 0;
  return { before, after, saved, percent, larger: after > before };
}

/** The one line under a result's name: `2.4 MB → 612 KB`. */
export function sizeLine(before: number, after: number): string {
  return `${formatSize(before)} → ${formatSize(after)}`;
}

/** True when an image of this size may be decoded at all. */
export function withinPixelLimit(width: number, height: number): boolean {
  return width > 0 && height > 0 && width * height <= MAX_PIXELS;
}

/**
 * The formats a browser writes, from the media types its encoder really produced for each one:
 * a browser without an encoder for a type gives PNG instead (Safari has no WebP encoder).
 */
export function writableFormats(produced: Readonly<Record<OutputFormat, string>>): OutputFormat[] {
  return (Object.keys(OUTPUT_FORMATS) as OutputFormat[]).filter(
    (format) => produced[format] === OUTPUT_FORMATS[format].mime,
  );
}

/**
 * The format to offer first: WebP when the browser can write it (smaller at the same quality),
 * else JPG, which every browser writes.
 */
export function defaultFormat(available: readonly OutputFormat[]): OutputFormat {
  return available.includes("webp") ? "webp" : "jpg";
}
