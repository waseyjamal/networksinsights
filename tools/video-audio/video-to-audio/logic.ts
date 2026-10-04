// Pure logic of "Video to audio": the file rules, the length limit, which outputs the visitor's
// browser can write for a given video, and the output names, with no DOM, no network and no
// top-level statements (docs/tool-contract.md, "logic.ts: what pure means"). worker.ts reads and
// writes the files with Mediabunny (ADR 0061); ui.tsx asks the browser what it can decode and
// encode, and this file turns the answers into choices.

import { safeFilename } from "@networksinsights/tool-sdk/download";

/** The limits the manifest declares and the page enforces: one source for both. */
export const LIMITS = {
  /** 1 GB. The video is read in pieces; only the audio is held in memory. */
  maxInputBytes: 1024 * 1024 * 1024,
  /** Two hours of sound. As WAV that is about 1.4 GB at 48 kHz stereo, so WAV has its own limit. */
  maxDurationSeconds: 2 * 60 * 60,
  /** 30 minutes for WAV: about 330 MB at 48 kHz stereo, which a phone can still hold. */
  maxWavSeconds: 30 * 60,
} as const;

export const OUTPUTS = {
  m4a: { label: "M4A (AAC)", extension: "m4a", mime: "audio/mp4" },
  wav: { label: "WAV (uncompressed)", extension: "wav", mime: "audio/wav" },
} as const;

export type OutputKind = keyof typeof OUTPUTS;

/** Kept for the manifest's input schema: the choice a visitor makes. */
export interface Input {
  output: OutputKind;
}

/** What the worker found in the video. Codecs use Mediabunny's names ("aac", "opus", "pcm-s16"). */
export interface Probe {
  durationSeconds: number;
  hasVideo: boolean;
  audio: {
    codec: string | null;
    sampleRate: number;
    channels: number;
    /** The WebCodecs decoder config, so the page can ask the browser whether it decodes it. */
    decoderConfig: AudioDecoderConfigLike | null;
  } | null;
}

/** The part of a WebCodecs AudioDecoderConfig the page passes back to the browser. */
export interface AudioDecoderConfigLike {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: unknown;
}

/** What the browser said it can do, asked by ui.tsx. */
export interface Support {
  /** The browser can decode this video's audio track (always true for PCM, which needs no codec). */
  decodeAudio: boolean;
  /** The browser can encode AAC with WebCodecs. */
  encodeAac: boolean;
}

export type Job =
  | { kind: "probe"; file: Blob }
  | { kind: "convert"; file: Blob; output: OutputKind; copy: boolean };

export type JobResult =
  | { kind: "probe"; probe: Probe }
  | { kind: "convert"; blob: Blob; copied: boolean; durationSeconds: number };

export const MESSAGES = {
  notVideo: "This file is not a video this tool reads. Choose an MP4, MOV or WebM file.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooLong: (limit: string) => `This video is longer than ${limit}.`,
  wavTooLong: (limit: string) =>
    `WAV is uncompressed, so it is offered for videos up to ${limit}. Choose M4A for a longer video.`,
  noAudio: "This video has no sound track, so there is no audio to save.",
  unreadable:
    "This file could not be read. It may be damaged, or use a format this tool cannot open.",
  failed: "The browser could not write the audio file.",
  cannotDecode:
    "Your browser cannot decode the sound in this video, so it can only copy it into M4A when it is already AAC.",
  noOutput:
    "Your browser cannot decode or encode the sound in this video, so this tool cannot save it here. A recent Chrome or Edge on a computer can.",
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

/** Refuses a video once it is read: no sound, or longer than the limit. Exactly at it is fine. */
export function checkProbe(probe: Probe): string | undefined {
  if (!probe.audio) return MESSAGES.noAudio;
  if (probe.durationSeconds > LIMITS.maxDurationSeconds)
    return MESSAGES.tooLong(formatDuration(LIMITS.maxDurationSeconds));
  return;
}

export interface OutputChoice {
  kind: OutputKind;
  /** Whether the browser can write it for this video. */
  available: boolean;
  /** M4A only: the AAC track is copied as it is, with no new encoding and no loss. */
  copy: boolean;
  /** Why it is not available, for the page. */
  reason?: string;
}

/**
 * The outputs for a probed video. M4A copies an AAC track untouched, which needs no codec at all;
 * any other track must be decoded and encoded again as AAC. WAV needs the sound decoded, and is
 * offered up to its own length limit.
 */
export function outputChoices(probe: Probe, support: Support): OutputChoice[] {
  const codec = probe.audio?.codec ?? null;
  const isAac = codec === "aac";
  const m4a: OutputChoice = isAac
    ? { kind: "m4a", available: true, copy: true }
    : support.decodeAudio && support.encodeAac
      ? { kind: "m4a", available: true, copy: false }
      : {
          kind: "m4a",
          available: false,
          copy: false,
          reason: support.decodeAudio
            ? "Your browser cannot encode AAC, and this sound is not AAC already."
            : "Your browser cannot decode this sound, and it is not AAC already.",
        };
  const wav: OutputChoice = !support.decodeAudio
    ? {
        kind: "wav",
        available: false,
        copy: false,
        reason: "Your browser cannot decode this sound.",
      }
    : probe.durationSeconds > LIMITS.maxWavSeconds
      ? {
          kind: "wav",
          available: false,
          copy: false,
          reason: MESSAGES.wavTooLong(formatDuration(LIMITS.maxWavSeconds)),
        }
      : { kind: "wav", available: true, copy: false };
  return [m4a, wav];
}

/** Whether a codec is raw PCM, which Mediabunny reads with no decoder. */
export function isPcm(codec: string | null): boolean {
  return codec?.startsWith("pcm-") ?? false;
}

/** "holiday.mp4" → "holiday.m4a", made safe as a file name. */
export function outputName(name: string, output: OutputKind): string {
  const base = name.replace(/\.[^.]*$/, "") || "audio";
  return safeFilename(`${base}.${OUTPUTS[output].extension}`);
}

/** Bytes as the page shows them: "1 GB", "12.5 MB", "980 KB", "512 bytes". */
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

/** Seconds as the page shows them: "2 hours", "30 minutes", "1:05:09", "4:07", "0:02". */
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
