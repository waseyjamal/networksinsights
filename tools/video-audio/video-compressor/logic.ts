// Pure logic of "Video compressor": the file rules, the length and resolution limits, the output
// size, the bitrate for an approximate target size, which containers the visitor's browser can
// write, and the output names, with no DOM, no network and no top-level statements
// (docs/tool-contract.md, "logic.ts: what pure means"). worker.ts converts with Mediabunny and the
// browser's WebCodecs encoders (ADR 0061); ui.tsx asks the browser what it can do.

import { safeFilename } from "@networksinsights/tool-sdk/download";

/** The limits the manifest declares and the page enforces: one source for both. */
export const LIMITS = {
  /** 500 MB per file. */
  maxInputBytes: 500 * 1024 * 1024,
  /** Ten minutes of video. The new file is built in memory. */
  maxDurationSeconds: 10 * 60,
  /** The largest picture read: 4K, 3840 × 2160, either way round. */
  maxLongSide: 3840,
  maxShortSide: 2160,
  /** The output is at most 1080p: its short side is at most 1080 pixels. */
  maxOutputShortSide: 1080,
  /** The smallest target size, and the lowest video bitrate a target may ask for. */
  minTargetMegabytes: 0.5,
  minVideoBitrate: 100_000,
} as const;

export const CONTAINERS = {
  mp4: { label: "MP4 (H.264)", extension: "mp4", mime: "video/mp4", video: "avc", audio: "aac" },
  webm: {
    label: "WebM (VP9)",
    extension: "webm",
    mime: "video/webm",
    video: "vp9",
    audio: "opus",
  },
} as const;

export type ContainerKind = keyof typeof CONTAINERS;

export const QUALITIES = {
  high: { label: "High: best picture, least saving" },
  medium: { label: "Medium: a good balance" },
  low: { label: "Low: smallest file" },
} as const;

export type QualityKind = keyof typeof QUALITIES;

export const RESOLUTIONS = {
  keep: { label: "Keep (up to 1080p)", shortSide: LIMITS.maxOutputShortSide },
  "720": { label: "720p", shortSide: 720 },
  "480": { label: "480p", shortSide: 480 },
} as const;

export type ResolutionKind = keyof typeof RESOLUTIONS;

/** Audio bitrate when the sound must be encoded again, and in the target-size sum. */
export const AUDIO_BITRATE = 128_000;

/** Kept for the manifest's input schema: the choices a visitor makes. */
export interface Input {
  container: ContainerKind;
  mode: "quality" | "size";
  quality: QualityKind;
  targetMegabytes: number;
  resolution: ResolutionKind;
}

/** The part of a WebCodecs decoder config the page passes back to the browser. */
export interface DecoderConfigLike {
  codec: string;
  description?: unknown;
  [key: string]: unknown;
}

/** What the worker found in the video. Codecs use Mediabunny's names ("avc", "vp9", "aac"). */
export interface Probe {
  durationSeconds: number;
  video: {
    codec: string | null;
    width: number;
    height: number;
    decoderConfig: DecoderConfigLike | null;
  } | null;
  audio: {
    codec: string | null;
    sampleRate: number;
    channels: number;
    decoderConfig: DecoderConfigLike | null;
  } | null;
}

/** What the browser said it can do, asked by ui.tsx. */
export interface Support {
  decodeVideo: boolean;
  decodeAudio: boolean;
  encodeAvc: boolean;
  encodeVp9: boolean;
  encodeAac: boolean;
  encodeOpus: boolean;
}

/** What happens to the sound in one container. */
export type AudioPlan = "none" | "copy" | "encode" | "drop";

export interface ContainerChoice {
  kind: ContainerKind;
  available: boolean;
  audio: AudioPlan;
  reason?: string;
}

/** What the page sends the worker to compress. */
export interface ConvertJob {
  kind: "convert";
  file: Blob;
  container: ContainerKind;
  width: number;
  height: number;
  /** A preset, or a video bitrate in bits per second for a target size. */
  quality: QualityKind | number;
  audio: AudioPlan;
}

export type Job = { kind: "probe"; file: Blob } | ConvertJob;

export type JobResult =
  | { kind: "probe"; probe: Probe }
  | { kind: "convert"; blob: Blob; width: number; height: number; audioKept: boolean };

export const MESSAGES = {
  notVideo: "This file is not a video this tool reads. Choose an MP4, MOV or WebM file.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooLong: (limit: string) => `This video is longer than ${limit}.`,
  tooBig: (width: number, height: number) =>
    `This video is ${width} × ${height} pixels, larger than the 4K (3840 × 2160) this tool reads.`,
  noVideo: "This file has no video track.",
  unreadable:
    "This file could not be read. It may be damaged, or use a format this tool cannot open.",
  failed: "The browser could not write the video.",
  noOutput:
    "Your browser cannot decode this video or cannot encode H.264 or VP9, so this tool cannot compress it here. A recent Chrome, Edge or Firefox on a computer can.",
  cannotDecode: "Your browser cannot decode this video.",
  noAvc: "Your browser cannot encode H.264 video at this size.",
  noVp9: "Your browser cannot encode VP9 video at this size.",
  targetTooSmall: (megabytes: number) =>
    `A file of ${megabytes} MB is too small for this video: choose a larger target or a lower resolution.`,
  targetTooLarge: "The target is not smaller than the file. Choose a smaller target.",
  targetInvalid: (min: number) => `Enter a target size of at least ${min} MB.`,
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

/** Refuses a video once it is read: no picture, too long, or larger than 4K. At a limit is fine. */
export function checkProbe(probe: Probe): string | undefined {
  if (!probe.video) return MESSAGES.noVideo;
  if (probe.durationSeconds > LIMITS.maxDurationSeconds)
    return MESSAGES.tooLong(formatDuration(LIMITS.maxDurationSeconds));
  const { width, height } = probe.video;
  if (Math.max(width, height) > LIMITS.maxLongSide || Math.min(width, height) > LIMITS.maxShortSide)
    return MESSAGES.tooBig(width, height);
  return;
}

/**
 * The output size: the picture scaled so its short side is at most the chosen one, never
 * enlarged, with even sides as video encoders need.
 */
export function outputSize(
  width: number,
  height: number,
  resolution: ResolutionKind,
): { width: number; height: number } {
  const short = Math.min(width, height);
  const scale = Math.min(1, RESOLUTIONS[resolution].shortSide / short);
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/**
 * The video bitrate that makes a file of about `targetMegabytes`: the target in bits over the
 * length, less the sound and 5% for the container. It is a guide for the encoder, so the file
 * comes out near the target, not exactly on it.
 */
export function bitrateForTarget(
  targetMegabytes: number,
  durationSeconds: number,
  audio: AudioPlan,
  audioBitrate: number,
): number {
  const totalBits = targetMegabytes * 1024 * 1024 * 8 * 0.95;
  const sound = audio === "none" || audio === "drop" ? 0 : audioBitrate;
  return Math.floor(totalBits / Math.max(durationSeconds, 0.001) - sound);
}

/** Refuses a target size that is not a number, below the minimum, too small or not smaller. */
export function checkTarget(
  targetMegabytes: number,
  fileBytes: number,
  durationSeconds: number,
  audio: AudioPlan,
): string | undefined {
  if (!Number.isFinite(targetMegabytes) || targetMegabytes < LIMITS.minTargetMegabytes)
    return MESSAGES.targetInvalid(LIMITS.minTargetMegabytes);
  if (targetMegabytes * 1024 * 1024 >= fileBytes) return MESSAGES.targetTooLarge;
  if (
    bitrateForTarget(targetMegabytes, durationSeconds, audio, AUDIO_BITRATE) <
    LIMITS.minVideoBitrate
  )
    return MESSAGES.targetTooSmall(targetMegabytes);
  return;
}

/**
 * The containers for a probed video. The picture must be decoded and encoded again in every case.
 * The sound is copied when the container holds its codec (AAC or Opus in MP4, Opus in WebM),
 * encoded again when the browser can, and otherwise left out, which the page says first.
 */
export function containerChoices(probe: Probe, support: Support): ContainerChoice[] {
  const audioCodec = probe.audio?.codec ?? null;
  const plan = (kind: ContainerKind): AudioPlan => {
    if (!probe.audio) return "none";
    const fits = kind === "mp4" ? ["aac", "opus"] : ["opus"];
    if (audioCodec !== null && fits.includes(audioCodec)) return "copy";
    const encode = kind === "mp4" ? support.encodeAac : support.encodeOpus;
    return support.decodeAudio && encode ? "encode" : "drop";
  };
  const choice = (kind: ContainerKind, encode: boolean, noEncoder: string): ContainerChoice => {
    if (!support.decodeVideo)
      return { kind, available: false, audio: plan(kind), reason: MESSAGES.cannotDecode };
    if (!encode) return { kind, available: false, audio: plan(kind), reason: noEncoder };
    return { kind, available: true, audio: plan(kind) };
  };
  return [
    choice("mp4", support.encodeAvc, MESSAGES.noAvc),
    choice("webm", support.encodeVp9, MESSAGES.noVp9),
  ];
}

/** "holiday.mp4" → "holiday-compressed.mp4", made safe as a file name. */
export function outputName(name: string, container: ContainerKind): string {
  const base = name.replace(/\.[^.]*$/, "") || "video";
  return safeFilename(`${base}-compressed.${CONTAINERS[container].extension}`);
}

/** Bytes as the page shows them: "500 MB", "12.5 MB", "980 KB", "512 bytes". */
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

/** Seconds as the page shows them: "10 minutes", "1:05:09", "4:07", "0:02". */
export function formatDuration(seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0)
    return `${seconds / 3600} ${seconds === 3600 ? "hour" : "hours"}`;
  if (seconds >= 60 && seconds % 60 === 0 && seconds < 3600)
    return `${seconds / 60} ${seconds === 60 ? "minute" : "minutes"}`;
  const whole = Math.round(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
