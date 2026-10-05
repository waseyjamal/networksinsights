// Pure logic of "Audio to MP3": the file rules, the length limit, the MP3 settings, the mix down to
// stereo and a reader of MP3 frame headers, with no DOM, no network and no top-level statements
// (docs/tool-contract.md, "logic.ts: what pure means"). worker.ts decodes the sound with Mediabunny
// (ADR 0061) and encodes it with LAME, served as its own unmodified file (ADR 0064).

import { safeFilename } from "@networksinsights/tool-sdk/download";

/** The limits the manifest declares and the page enforces: one source for both. */
export const LIMITS = {
  /** 300 MB per file. It is read in pieces; only the MP3 is held in memory. */
  maxInputBytes: 300 * 1024 * 1024,
  /** Two hours of sound: at 320 kbit/s that is about 290 MB of MP3. */
  maxDurationSeconds: 2 * 60 * 60,
} as const;

/** LAME, served unmodified on this site (ADR 0064). A test keeps it in step with the vendor route. */
export const MP3_WASM_URL = "/vendor/wasm-media-encoders/0.7.0/mp3.wasm";

/** Constant bitrates offered, in kbit/s. All are MPEG-1 Layer III rates. */
export const BITRATES = [128, 192, 320] as const;
export type Bitrate = (typeof BITRATES)[number];
export const DEFAULT_BITRATE: Bitrate = 192;

/** Kept for the manifest's input schema: the choice a visitor makes. */
export interface Input {
  bitrate: Bitrate;
}

/** What the worker found in the recording. Codecs use Mediabunny's names ("aac", "opus", "pcm-s16"). */
export interface Probe {
  durationSeconds: number;
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

export type Job = { kind: "probe"; file: Blob } | { kind: "convert"; file: Blob; bitrate: Bitrate };

export type JobResult =
  | { kind: "probe"; probe: Probe }
  | { kind: "convert"; blob: Blob; durationSeconds: number };

export const MESSAGES = {
  notAudio:
    "This file is not a recording this tool reads. Choose a WAV, FLAC, M4A, AAC, OGG, Opus or WebM file.",
  alreadyMp3: "This file is an MP3 already. Choose a recording in another format.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooLong: (limit: string) => `This recording is longer than ${limit}.`,
  noAudio: "This file has no sound track, so there is nothing to convert.",
  unreadable:
    "This file could not be read. It may be damaged, or use a format this tool cannot open.",
  cannotDecode:
    "Your browser cannot decode this recording, so it cannot make an MP3 of it here. A recent Chrome or Edge on a computer decodes the most formats.",
  encoderMissing: "The MP3 encoder could not be loaded. Check your connection and try again.",
  failed: "The browser could not write the MP3 file.",
} as const;

const MEDIA_TYPES = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave",
  "audio/flac",
  "audio/x-flac",
  "audio/ogg",
  "audio/opus",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/webm",
]);

/** A recording this tool reads, by media type or, when the browser gave none, by extension. */
export function isAudioFile(file: { name: string; type: string }): boolean {
  if (MEDIA_TYPES.has(file.type.toLowerCase())) return true;
  if (file.type !== "" && file.type !== "application/octet-stream") return false;
  return /\.(wav|wave|flac|ogg|oga|opus|m4a|aac|weba|webm)$/i.test(file.name);
}

/** Whether a file is an MP3 already, by type or extension. */
export function isMp3File(file: { name: string; type: string }): boolean {
  return /^audio\/(mpeg|mp3)$/i.test(file.type) || /\.mp3$/i.test(file.name);
}

/** Refuses a file before it is read: the wrong kind, or one byte over the size limit. */
export function checkFile(file: { name: string; type: string; size: number }): string | undefined {
  if (isMp3File(file)) return MESSAGES.alreadyMp3;
  if (!isAudioFile(file)) return MESSAGES.notAudio;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return;
}

/** Refuses a recording once it is read: no sound, or longer than the limit. Exactly at it is fine. */
export function checkProbe(probe: Probe): string | undefined {
  if (!probe.audio) return MESSAGES.noAudio;
  if (probe.durationSeconds > LIMITS.maxDurationSeconds)
    return MESSAGES.tooLong(formatDuration(LIMITS.maxDurationSeconds));
  return;
}

/** Whether a codec is raw PCM, which Mediabunny reads with no decoder. */
export function isPcm(codec: string | null): boolean {
  return codec?.startsWith("pcm-") ?? false;
}

/** The sample rates MPEG-1 Layer III can store; every offered bitrate needs MPEG-1. */
export type Mp3SampleRate = 32000 | 44100 | 48000;

export interface EncoderSettings {
  channels: 1 | 2;
  /** The rate of the samples handed to LAME: the source's own. */
  sampleRate: number;
  /** The rate of the MP3. LAME resamples when it differs from `sampleRate`. */
  outputSampleRate: Mp3SampleRate;
  bitrate: Bitrate;
}

/**
 * LAME settings for a source. Mono stays mono; two or more channels become stereo. A source at an
 * MPEG-1 rate keeps it; anything above 44.1 kHz becomes 48 kHz, and anything else 44.1 kHz.
 */
export function encoderSettings(
  sampleRate: number,
  channels: number,
  bitrate: Bitrate,
): EncoderSettings {
  const outputSampleRate: Mp3SampleRate =
    sampleRate === 32000 || sampleRate === 44100 || sampleRate === 48000
      ? sampleRate
      : sampleRate > 44100
        ? 48000
        : 44100;
  return { channels: channels <= 1 ? 1 : 2, sampleRate, outputSampleRate, bitrate };
}

/**
 * Planar samples mixed to the channels LAME takes. One plane stays as it is, two stay as they
 * are, and more are mixed down: even planes to the left, odd planes to the right, averaged.
 */
export function mixDown(planes: readonly Float32Array[], channels: 1 | 2): Float32Array[] {
  const first = planes[0];
  if (!first) return [];
  if (channels === 1) {
    if (planes.length === 1) return [first];
    return [average(planes, 0, 1)];
  }
  if (planes.length === 1) return [first, first];
  if (planes.length === 2) return [first, planes[1] ?? first];
  return [average(planes, 0, 2), average(planes, 1, 2)];
}

function average(planes: readonly Float32Array[], start: number, step: number): Float32Array {
  const length = planes[0]?.length ?? 0;
  const out = new Float32Array(length);
  let count = 0;
  for (let index = start; index < planes.length; index += step) {
    const plane = planes[index];
    if (!plane) continue;
    count++;
    for (let i = 0; i < length; i++) out[i] = (out[i] ?? 0) + (plane[i] ?? 0);
  }
  if (count > 1) for (let i = 0; i < length; i++) out[i] = (out[i] ?? 0) / count;
  return out;
}

/** About how large the MP3 will be, in bytes: the bitrate times the length. */
export function estimateBytes(durationSeconds: number, bitrate: Bitrate): number {
  return Math.round((durationSeconds * bitrate * 1000) / 8);
}

/** What the frame headers of an MP3 say, for the page and for tests that read a real output. */
export interface Mp3Info {
  frames: number;
  sampleRate: number;
  channels: 1 | 2;
  /** The bitrates found, in kbit/s; one value for a constant bitrate file. */
  bitrates: number[];
  durationSeconds: number;
}

const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG1_RATES = [44100, 48000, 32000];

/**
 * Walks the MPEG-1 Layer III frames of an MP3 from its first frame to the end. Returns null when
 * the bytes do not start with a run of valid frames (an ID3 tag at the start is skipped).
 */
export function readMp3(bytes: Uint8Array): Mp3Info | null {
  let offset = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 && bytes.length >= 10) {
    const size =
      ((bytes[6] ?? 0) << 21) | ((bytes[7] ?? 0) << 14) | ((bytes[8] ?? 0) << 7) | (bytes[9] ?? 0);
    offset = 10 + size;
  }
  let frames = 0;
  let sampleRate = 0;
  let channels: 1 | 2 = 2;
  const bitrates = new Set<number>();
  while (offset + 4 <= bytes.length) {
    const b1 = bytes[offset + 1] ?? 0;
    const b2 = bytes[offset + 2] ?? 0;
    const b3 = bytes[offset + 3] ?? 0;
    // Sync, MPEG-1 (bits 11), Layer III (bits 01).
    if (bytes[offset] !== 0xff || (b1 & 0xfe) !== 0xfa) break;
    const bitrate = MPEG1_L3_BITRATES[b2 >> 4];
    const rate = MPEG1_RATES[(b2 >> 2) & 3];
    if (!bitrate || !rate) break;
    const padding = (b2 >> 1) & 1;
    const length = Math.floor((144000 * bitrate) / rate) + padding;
    if (sampleRate !== 0 && rate !== sampleRate) break;
    sampleRate = rate;
    channels = b3 >> 6 === 3 ? 1 : 2;
    bitrates.add(bitrate);
    frames++;
    offset += length;
  }
  if (frames === 0) return null;
  return {
    frames,
    sampleRate,
    channels,
    bitrates: [...bitrates].sort((a, b) => a - b),
    durationSeconds: (frames * 1152) / sampleRate,
  };
}

/** "interview.wav" → "interview.mp3", made safe as a file name. */
export function outputName(name: string): string {
  const base = name.replace(/\.[^.]*$/, "") || "audio";
  return safeFilename(`${base}.mp3`);
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
