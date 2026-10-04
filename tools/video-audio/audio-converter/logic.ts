// Pure logic of "Audio converter": the file rules, the length limits, which outputs the visitor's
// browser can write for a given file, and the output names, with no DOM, no network and no
// top-level statements (docs/tool-contract.md, "logic.ts: what pure means"). worker.ts converts
// with Mediabunny and, for FLAC, its libFLAC encoder in WebAssembly (ADR 0061); ui.tsx asks the
// browser what it can decode and encode, and this file turns the answers into choices.

import { safeFilename } from "@networksinsights/tool-sdk/download";

/** The limits the manifest declares and the page enforces: one source for both. */
export const LIMITS = {
  /** 300 MB per file. */
  maxInputBytes: 300 * 1024 * 1024,
  /** Two hours of sound for the compressed outputs. */
  maxDurationSeconds: 2 * 60 * 60,
  /** 30 minutes for WAV and FLAC: about 330 MB of WAV at 48 kHz stereo, held in memory. */
  maxLosslessSeconds: 30 * 60,
} as const;

export const OUTPUTS = {
  wav: { label: "WAV (uncompressed)", extension: "wav", mime: "audio/wav", lossless: true },
  flac: { label: "FLAC (lossless)", extension: "flac", mime: "audio/flac", lossless: true },
  ogg: { label: "OGG Opus", extension: "ogg", mime: "audio/ogg", lossless: false },
  m4a: { label: "M4A (AAC)", extension: "m4a", mime: "audio/mp4", lossless: false },
} as const;

export type OutputKind = keyof typeof OUTPUTS;

export const BITRATES = {
  "96": { label: "96 kbit/s (speech, small)", value: 96_000 },
  "128": { label: "128 kbit/s (good for music)", value: 128_000 },
  "192": { label: "192 kbit/s (high)", value: 192_000 },
} as const;

export type Bitrate = keyof typeof BITRATES;

/** Kept for the manifest's input schema: the choices a visitor makes. */
export interface Input {
  output: OutputKind;
  bitrate: Bitrate;
}

/** The part of a WebCodecs AudioDecoderConfig the page passes back to the browser. */
export interface AudioDecoderConfigLike {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: unknown;
}

/** What the worker found in the file. Codecs use Mediabunny's names ("aac", "opus", "pcm-s16"). */
export interface Probe {
  durationSeconds: number;
  codec: string | null;
  sampleRate: number;
  channels: number;
  decoderConfig: AudioDecoderConfigLike | null;
}

/** What the browser said it can do, asked by ui.tsx. */
export interface Support {
  /** The browser can decode this file's sound (always true for PCM, which needs no codec). */
  decode: boolean;
  encodeOpus: boolean;
  encodeAac: boolean;
  /** WebAssembly and Web Workers, which the FLAC encoder runs on. */
  wasm: boolean;
}

export type Job =
  | { kind: "probe"; file: Blob }
  | { kind: "convert"; file: Blob; output: OutputKind; bitrate: number };

export type JobResult =
  | { kind: "probe"; probe: Probe }
  | { kind: "convert"; blob: Blob; copied: boolean };

export const MESSAGES = {
  notAudio: "This file is not audio this tool reads. Choose a WAV, FLAC, OGG, M4A or WebM file.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooLong: (limit: string) => `This recording is longer than ${limit}.`,
  losslessTooLong: (limit: string) =>
    `Lossless files are offered for recordings up to ${limit}, because they must fit in memory.`,
  noAudio: "This file has no sound track.",
  unreadable:
    "This file could not be read. It may be damaged, or use a format this tool cannot open.",
  failed: "The browser could not write the audio file.",
  noOutput:
    "Your browser cannot decode the sound in this file, so this tool cannot convert it here. A recent Chrome, Edge or Firefox on a computer can.",
  cannotDecode: "Your browser cannot decode this sound.",
  noOpus: "Your browser cannot encode Opus.",
  noAac: "Your browser cannot encode AAC.",
  noWasm: "Your browser cannot run the FLAC encoder.",
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

/** An audio file this tool reads, by media type or, when the browser gave none, by extension. */
export function isAudioFile(file: { name: string; type: string }): boolean {
  if (MEDIA_TYPES.has(file.type.toLowerCase())) return true;
  if (file.type !== "" && file.type !== "application/octet-stream") return false;
  return /\.(wav|wave|flac|ogg|oga|opus|m4a|aac|weba|webm)$/i.test(file.name);
}

/** Refuses a file before it is read: the wrong kind, or one byte over the size limit. */
export function checkFile(file: { name: string; type: string; size: number }): string | undefined {
  if (!isAudioFile(file)) return MESSAGES.notAudio;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return;
}

/** Refuses a recording once it is read: longer than the limit. Exactly at it is fine. */
export function checkProbe(probe: Probe): string | undefined {
  if (probe.durationSeconds > LIMITS.maxDurationSeconds)
    return MESSAGES.tooLong(formatDuration(LIMITS.maxDurationSeconds));
  return;
}

/** Whether a codec is raw PCM, which Mediabunny reads with no decoder. */
export function isPcm(codec: string | null): boolean {
  return codec?.startsWith("pcm-") ?? false;
}

export interface OutputChoice {
  kind: OutputKind;
  available: boolean;
  /** Same codec in, same codec out: the sound is copied, not encoded again. */
  copy: boolean;
  reason?: string;
}

/**
 * The outputs for a probed file. Every output needs the sound decoded, except a copy of the same
 * codec (Opus into OGG, AAC into M4A). Opus and AAC need the browser's encoder; FLAC is encoded by
 * libFLAC in WebAssembly, so it needs no browser codec. WAV and FLAC are held in memory, so they
 * have a shorter length limit.
 */
export function outputChoices(probe: Probe, support: Support): OutputChoice[] {
  const decode = support.decode || isPcm(probe.codec);
  const tooLongForLossless = probe.durationSeconds > LIMITS.maxLosslessSeconds;
  const lossless = (kind: "wav" | "flac"): OutputChoice => {
    if (!decode) return { kind, available: false, copy: false, reason: MESSAGES.cannotDecode };
    if (kind === "flac" && !support.wasm)
      return { kind, available: false, copy: false, reason: MESSAGES.noWasm };
    if (tooLongForLossless)
      return {
        kind,
        available: false,
        copy: false,
        reason: MESSAGES.losslessTooLong(formatDuration(LIMITS.maxLosslessSeconds)),
      };
    return { kind, available: true, copy: false };
  };
  const lossy = (kind: "ogg" | "m4a", codec: string, encode: boolean, noEncoder: string) => {
    if (probe.codec === codec) return { kind, available: true, copy: true };
    if (!decode) return { kind, available: false, copy: false, reason: MESSAGES.cannotDecode };
    if (!encode) return { kind, available: false, copy: false, reason: noEncoder };
    return { kind, available: true, copy: false };
  };
  return [
    lossless("wav"),
    lossless("flac"),
    lossy("ogg", "opus", support.encodeOpus, MESSAGES.noOpus),
    lossy("m4a", "aac", support.encodeAac, MESSAGES.noAac),
  ];
}

/** "song.m4a" → "song.flac"; the same name with a suffix when only the extension would match. */
export function outputName(name: string, output: OutputKind): string {
  const extension = OUTPUTS[output].extension;
  const base = name.replace(/\.[^.]*$/, "") || "audio";
  const same = name.toLowerCase().endsWith(`.${extension}`);
  return safeFilename(`${base}${same ? "-converted" : ""}.${extension}`);
}

/** Bytes as the page shows them: "300 MB", "12.5 MB", "980 KB", "512 bytes". */
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
