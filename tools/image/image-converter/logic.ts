// Pure logic of "Image Converter": the rules the workspace and the worker follow, with no DOM, no
// network and no top-level statements (docs/tool-contract.md, "logic.ts: what pure means").
// The pixels are handled in worker.ts, with the browser's own decoder and encoder.

import { safeFilename } from "@networksinsights/tool-sdk/download";

/** The limits the manifest declares and the page enforces: one source for both. */
export const LIMITS = {
  /** 25 MB per file. */
  maxInputBytes: 25 * 1024 * 1024,
  maxFiles: 20,
} as const;

/** 50 megapixels: four bytes a pixel keeps one decoded image under 200 MB of memory. */
export const MAX_PIXELS = 50_000_000;

/** The quality JPG and WebP are written at. High, so a conversion loses as little as it can. */
export const LOSSY_QUALITY = 0.92;

export const INPUT_TYPES = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
} as const;

export type InputType = keyof typeof INPUT_TYPES;

export const OUTPUT_FORMATS = {
  jpg: { mime: "image/jpeg", label: "JPG", extension: "jpg" },
  png: { mime: "image/png", label: "PNG", extension: "png" },
  webp: { mime: "image/webp", label: "WebP", extension: "webp" },
} as const;

export type OutputFormat = keyof typeof OUTPUT_FORMATS;

/** What the page sends the worker. */
export interface Job {
  file: Blob;
  format: OutputFormat;
}

/** What the worker sends back. */
export interface JobResult {
  blob: Blob;
  width: number;
  height: number;
}

/** Kept for the manifest's input schema: the choice a visitor makes. */
export interface Input {
  format: OutputFormat;
}

export const MESSAGES = {
  notAnImage: "This file is not a JPG, PNG or WebP image.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooManyFiles: (count: number) => `Only ${count} files can be converted at once.`,
  unreadable: "The browser could not read this image. It may be damaged.",
  tooManyPixels: "This image has more pixels than the browser can hold in memory.",
  formatUnavailable: (format: string) => `This browser cannot write ${format} files.`,
  failed: "The browser could not convert this image.",
} as const;

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

/** Splits added files into the ones taken and the ones refused, with the reason. */
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

/** `holiday photo.png` as JPG is `holiday photo.jpg`. */
export function outputName(inputName: string, format: OutputFormat): string {
  const base = inputName.replace(/\.[a-z0-9]{1,5}$/i, "") || "image";
  const { extension } = OUTPUT_FORMATS[format];
  return safeFilename(`${base}.${extension}`, { extension, fallback: "image" });
}

/** Bytes as a person reads them, in steps of 1,024. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function withinPixelLimit(width: number, height: number): boolean {
  return width > 0 && height > 0 && width * height <= MAX_PIXELS;
}

/** JPG has no transparency: transparent areas get a white background. */
export function needsBackground(format: OutputFormat): boolean {
  return format === "jpg";
}

/** The encoder quality for a format; PNG is lossless and takes none. */
export function qualityFor(format: OutputFormat): number | undefined {
  if (format === "png") return;
  return LOSSY_QUALITY;
}

/**
 * The formats a browser writes, from the media types its encoder really produced: a browser
 * without an encoder for a type gives PNG instead (Safari has no WebP encoder).
 */
export function writableFormats(produced: Readonly<Record<OutputFormat, string>>): OutputFormat[] {
  return (Object.keys(OUTPUT_FORMATS) as OutputFormat[]).filter(
    (format) => produced[format] === OUTPUT_FORMATS[format].mime,
  );
}

/** The format offered first: JPG, which every browser writes and every program opens. */
export function defaultFormat(available: readonly OutputFormat[]): OutputFormat {
  return available.includes("jpg") ? "jpg" : (available[0] ?? "png");
}
