// Pure logic of "Video to GIF": the file rules, the clip, width and frame rate limits, the times of
// the frames to take, the GIF's size and the output name, with no DOM, no network and no top-level
// statements (docs/tool-contract.md, "logic.ts: what pure means"). worker.ts takes the frames with
// Mediabunny and the browser's WebCodecs decoder, and writes the GIF with gifenc (ADR 0061).

import { safeFilename } from "@networksinsights/tool-sdk/download";

/** The limits the manifest declares and the page enforces: one source for both. */
export const LIMITS = {
  /** 200 MB per video. Only the frames of the clip are decoded. */
  maxInputBytes: 200 * 1024 * 1024,
  /** At most 30 seconds of video become a GIF. */
  maxClipSeconds: 30,
  minClipSeconds: 0.1,
  /** GIF width in pixels: at most 480, at least 16. */
  maxWidth: 480,
  minWidth: 16,
  /** Frames a second: at most 15, at least 1. */
  maxFps: 15,
  minFps: 1,
} as const;

export const DEFAULTS = { start: 0, length: 5, width: 320, fps: 10 } as const;

/** Kept for the manifest's input schema: the choices a visitor makes. */
export interface Input {
  start: number;
  length: number;
  width: number;
  fps: number;
}

/** The part of a WebCodecs VideoDecoderConfig the page passes back to the browser. */
export interface DecoderConfigLike {
  codec: string;
  description?: unknown;
}

export interface Probe {
  durationSeconds: number;
  /** The time of the first frame, which is not always zero. */
  startSeconds: number;
  video: {
    codec: string | null;
    width: number;
    height: number;
    decoderConfig: DecoderConfigLike | null;
  } | null;
}

export interface ConvertJob {
  kind: "convert";
  file: Blob;
  times: number[];
  width: number;
  height: number;
  /** Time between frames, in milliseconds. */
  delay: number;
}

export type Job = { kind: "probe"; file: Blob } | ConvertJob;

export type JobResult =
  | { kind: "probe"; probe: Probe }
  | { kind: "convert"; blob: Blob; frames: number };

export const MESSAGES = {
  notVideo: "This file is not a video this tool reads. Choose an MP4, MOV or WebM file.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  noVideo: "This file has no video track.",
  unreadable:
    "This file could not be read. It may be damaged, or use a format this tool cannot open.",
  failed: "The GIF could not be made from this video.",
  noFrames: "No frames could be taken from this part of the video.",
  cannotDecode:
    "Your browser cannot decode this video, so this tool cannot make a GIF from it here. A recent Chrome, Edge or Firefox on a computer can.",
  noCanvas:
    "Your browser cannot draw video frames in a background worker, so this tool cannot make a GIF here. A recent Chrome, Edge or Firefox on a computer can.",
  start: "Enter a start time of 0 seconds or more.",
  startAfterEnd: (duration: string) =>
    `The start must be before the end of the video (${duration}).`,
  length: (min: number, max: number) => `Enter a length from ${min} to ${max} seconds.`,
  width: (min: number, max: number) => `Enter a width from ${min} to ${max} pixels.`,
  fps: (min: number, max: number) => `Enter a frame rate from ${min} to ${max} frames a second.`,
} as const;

const MEDIA_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"]);

/** A video this tool reads, by media type or, when the browser gave none, by extension. */
export function isVideoFile(file: { name: string; type: string }): boolean {
  if (MEDIA_TYPES.has(file.type.toLowerCase())) return true;
  if (file.type !== "" && file.type !== "application/octet-stream") return false;
  return /\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name);
}

/** Refuses a file before it is read: the wrong kind, or one byte over the size limit. */
export function checkFile(file: { name: string; type: string; size: number }): string | undefined {
  if (!isVideoFile(file)) return MESSAGES.notVideo;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return;
}

export interface ClipProblems {
  start?: string;
  length?: string;
  width?: string;
  fps?: string;
}

/**
 * The problems with the visitor's settings, per field. Each limit holds exactly: a length of 30
 * seconds, a width of 480 pixels and 15 frames a second are accepted, anything more is refused.
 * The width is a whole number of pixels and the frame rate a whole number of frames.
 */
export function checkClip(input: Input, durationSeconds: number): ClipProblems {
  const problems: ClipProblems = {};
  if (!Number.isFinite(input.start) || input.start < 0) problems.start = MESSAGES.start;
  else if (input.start >= durationSeconds)
    problems.start = MESSAGES.startAfterEnd(formatSeconds(durationSeconds));
  if (
    !Number.isFinite(input.length) ||
    input.length < LIMITS.minClipSeconds ||
    input.length > LIMITS.maxClipSeconds
  )
    problems.length = MESSAGES.length(LIMITS.minClipSeconds, LIMITS.maxClipSeconds);
  if (
    !Number.isInteger(input.width) ||
    input.width < LIMITS.minWidth ||
    input.width > LIMITS.maxWidth
  )
    problems.width = MESSAGES.width(LIMITS.minWidth, LIMITS.maxWidth);
  if (!Number.isInteger(input.fps) || input.fps < LIMITS.minFps || input.fps > LIMITS.maxFps)
    problems.fps = MESSAGES.fps(LIMITS.minFps, LIMITS.maxFps);
  return problems;
}

/**
 * The times of the frames to take, in seconds of the video: one every 1/fps from the start, for
 * the clip's length or up to the end of the video, whichever comes first. Always at least one.
 */
export function frameTimes(
  start: number,
  length: number,
  fps: number,
  durationSeconds: number,
  firstFrameSeconds = 0,
): number[] {
  const end = Math.min(start + length, durationSeconds);
  const count = Math.max(1, Math.round((end - start) * fps));
  return Array.from({ length: count }, (_, index) =>
    Math.max(firstFrameSeconds, start + index / fps),
  );
}

/** The GIF's size: the chosen width, and the height that keeps the picture's shape. */
export function gifSize(
  videoWidth: number,
  videoHeight: number,
  width: number,
): { width: number; height: number } {
  return { width, height: Math.max(1, Math.round((width * videoHeight) / videoWidth)) };
}

/** Time between frames in milliseconds. GIF stores hundredths of a second, so gifenc rounds it. */
export function frameDelay(fps: number): number {
  return Math.round(1000 / fps);
}

/** How many pixels of a frame its palette is chosen from. */
export const PALETTE_SAMPLE_PIXELS = 16_384;

/**
 * An even sample of a frame's RGBA pixels, at most `maxPixels` of them, to choose its palette
 * from. A frame with no more pixels than that is returned as it is.
 */
export function paletteSample(rgba: Uint8ClampedArray, maxPixels: number): Uint8ClampedArray {
  const pixels = Math.floor(rgba.length / 4);
  const step = Math.max(1, Math.ceil(pixels / maxPixels));
  if (step === 1) return rgba;
  const out = new Uint8ClampedArray(Math.ceil(pixels / step) * 4);
  for (let pixel = 0, at = 0; pixel < pixels; pixel += step, at += 4) {
    out.set(rgba.subarray(pixel * 4, pixel * 4 + 4), at);
  }
  return out;
}

/** "holiday.mp4" → "holiday.gif", made safe as a file name. */
export function outputName(name: string): string {
  const base = name.replace(/\.[^.]*$/, "") || "animation";
  return safeFilename(`${base}.gif`);
}

/** Seconds as the page shows them, with one decimal when needed: "31 s", "2.5 s". */
export function formatSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  return `${rounded} s`;
}

/** Bytes as the page shows them: "200 MB", "12.5 MB", "980 KB", "512 bytes". */
export function formatSize(bytes: number): string {
  const units = [
    ["GB", 1024 ** 3],
    ["MB", 1024 ** 2],
    ["KB", 1024],
  ] as const;
  for (const [unit, size] of units) {
    if (bytes >= size) {
      const value = bytes / size;
      const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
      return `${shown} ${unit}`;
    }
  }
  return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
}
