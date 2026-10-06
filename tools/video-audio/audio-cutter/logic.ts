// Pure logic of "Audio Cutter": the file rules, reading times such as 1:05.5, checking the cut,
// the two ways to cut and the output names, with no DOM, no network and no top-level statements
// (docs/tool-contract.md, "logic.ts: what pure means"). worker.ts cuts with Mediabunny (ADR 0061);
// ui.tsx asks the browser with WebCodecs whether it can decode the sound.

/** The limits the manifest declares and the page enforces: one source for both. */
export const LIMITS = {
  /** 300 MB per file, read in pieces. The new file is built in memory. */
  maxInputBytes: 300 * 1024 * 1024,
  maxFiles: 1,
  /** The shortest cut, in milliseconds. Our own choice. */
  minCutMs: 100,
  /**
   * The longest exact cut, in milliseconds: ten minutes, our own choice. Ten minutes of 48 kHz
   * stereo WAV is about 110 MB, built in memory.
   */
  maxWavCutMs: 10 * 60 * 1000,
} as const;

/**
 * Copy keeps the encoded sound as it is, so the cut can only fall between the small packets the
 * sound is stored in. WAV decodes the sound and writes plain 16-bit samples, cut on the exact
 * sample.
 */
export const MODES = {
  copy: "Keep the format: no re-encoding",
  wav: "Exact cut as WAV: decodes the sound",
} as const;

export type Mode = keyof typeof MODES;

/** Kept for the manifest's input schema: the choices a visitor makes. */
export interface Input {
  start: string;
  end: string;
  mode: Mode;
}

/** The part of a WebCodecs AudioDecoderConfig the page passes back to the browser. */
export interface AudioDecoderConfigLike {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: unknown;
}

/** What the worker found in the recording. Codecs use Mediabunny's names ("aac", "pcm-s16"). */
export interface Probe {
  durationSeconds: number;
  codec: string | null;
  sampleRate: number;
  channels: number;
  decoderConfig: AudioDecoderConfigLike | null;
  /** True when Mediabunny can cut this file by copying, into an M4A file. */
  copyable: boolean;
}

export type Job =
  | { kind: "probe"; file: Blob }
  | { kind: "cut"; file: Blob; startMs: number; endMs: number; mode: Mode };

export type JobResult =
  | { kind: "probe"; probe: Probe }
  | {
      kind: "cut";
      blob: Blob;
      /** The length of the new file, in milliseconds, read back from it. */
      durationMs: number;
    };

export const MESSAGES = {
  notAudio: "This file is not a recording this tool reads. Choose a WAV, M4A, OGG or WebM file.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  noAudio: "This file has no sound track, so there is nothing to cut.",
  unreadable:
    "This file could not be read. It may be damaged, or use a format this tool cannot open.",
  badTime: (which: "start" | "end") =>
    `Write the ${which} as seconds, such as 12.5, or as minutes and seconds, such as 1:05.`,
  order: "The end must come after the start.",
  tooShort: `The cut must be at least ${LIMITS.minCutMs / 1000} seconds long.`,
  wavTooLong: `An exact WAV cut can be at most ${LIMITS.maxWavCutMs / 60_000} minutes long. Choose a shorter part, or keep the format.`,
  pastEnd: (duration: string) => `The recording is only ${duration} long.`,
  noWav:
    "Your browser cannot decode this recording, so the exact WAV cut is not offered. A recent Chrome or Edge on a computer decodes the most formats.",
  noCopy:
    "This recording cannot be cut without re-encoding: only M4A files can. The exact WAV cut is offered instead.",
  cannot:
    "Your browser cannot cut this recording: it cannot decode it, and its format cannot be cut without re-encoding. A recent Chrome or Edge on a computer decodes the most formats.",
  failed: "The browser could not write the new file.",
} as const;

const MEDIA_TYPES = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave",
  "audio/ogg",
  "audio/opus",
  "audio/mp4",
  "audio/x-m4a",
  "audio/webm",
]);

/** A recording this tool reads, by media type or, when the browser gave none, by extension. */
export function isAudioFile(file: { name: string; type: string }): boolean {
  if (MEDIA_TYPES.has(file.type.toLowerCase())) return true;
  if (file.type !== "" && file.type !== "application/octet-stream") return false;
  return /\.(wav|wave|ogg|oga|opus|m4a|weba|webm)$/i.test(file.name);
}

export function checkFile(file: { name: string; type: string; size: number }): string | undefined {
  if (!isAudioFile(file)) return MESSAGES.notAudio;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return;
}

/** Whether a codec is raw PCM, which Mediabunny reads with no decoder. */
export function isPcm(codec: string | null): boolean {
  return codec?.startsWith("pcm-") ?? false;
}

/** The ways to cut this file, in the order offered: copy first, as it keeps the sound as it is. */
export function modesFor(copyable: boolean, decodable: boolean): Mode[] {
  const modes: Mode[] = [];
  if (copyable) modes.push("copy");
  if (decodable) modes.push("wav");
  return modes;
}

/** The note shown under the modes when one of them, or both, cannot be offered. */
export function supportNote(copyable: boolean, decodable: boolean): string | undefined {
  if (!copyable && !decodable) return MESSAGES.cannot;
  if (!decodable) return MESSAGES.noWav;
  if (!copyable) return MESSAGES.noCopy;
  return;
}

/**
 * A time in whole milliseconds from text: `12`, `12.5`, `1:05`, `1:05.25` or `1:02:03`. Decimals
 * past the third are refused, so nothing is rounded silently. Undefined when it is not a time.
 */
export function parseTime(text: string): number | undefined {
  const cleaned = text.trim().replace(",", ".");
  const match = /^(?:(?:(\d+):)?(\d+):)?(\d+)(?:\.(\d{1,3}))?$/.exec(cleaned);
  if (!match) return;
  const [, hours, minutes, seconds, fraction] = match;
  if ((typeof hours !== "undefined" || typeof minutes !== "undefined") && Number(seconds) >= 60)
    return;
  if (typeof hours !== "undefined" && Number(minutes) >= 60) return;
  const ms =
    ((Number(hours ?? 0) * 60 + Number(minutes ?? 0)) * 60 + Number(seconds)) * 1000 +
    Number((fraction ?? "").padEnd(3, "0"));
  if (!Number.isSafeInteger(ms)) return;
  return ms;
}

/** Milliseconds as `m:ss.sss`, or `h:mm:ss.sss`, without trailing zeros in the fraction. */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const fraction = total % 1000;
  const seconds = Math.floor(total / 1000) % 60;
  const minutes = Math.floor(total / 60_000) % 60;
  const hours = Math.floor(total / 3_600_000);
  const tail = fraction ? `.${String(fraction).padStart(3, "0").replace(/0+$/, "")}` : "";
  const ss = `${String(seconds).padStart(2, "0")}${tail}`;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}

/** Checks the start and end against each other, the recording's length and the mode's limit. */
export function checkCut(
  start: string,
  end: string,
  durationMs: number,
  mode: Mode,
): { ok: true; startMs: number; endMs: number } | { ok: false; error: string } {
  const startMs = parseTime(start);
  if (typeof startMs === "undefined") return { ok: false, error: MESSAGES.badTime("start") };
  const endMs = parseTime(end);
  if (typeof endMs === "undefined") return { ok: false, error: MESSAGES.badTime("end") };
  if (endMs <= startMs) return { ok: false, error: MESSAGES.order };
  if (endMs > durationMs) return { ok: false, error: MESSAGES.pastEnd(formatTime(durationMs)) };
  if (endMs - startMs < LIMITS.minCutMs) return { ok: false, error: MESSAGES.tooShort };
  if (mode === "wav" && endMs - startMs > LIMITS.maxWavCutMs) {
    return { ok: false, error: MESSAGES.wavTooLong };
  }
  return { ok: true, startMs, endMs };
}

/** The recording's length in whole milliseconds, rounded down so the end field never passes it. */
export function durationMs(seconds: number): number {
  return Math.floor(seconds * 1000 + 1e-6);
}

/** `talk.m4a` becomes `talk-cut.m4a` when copied, or `talk-cut.wav` when cut exactly. */
export function outputName(inputName: string, mode: Mode): string {
  const base = inputName.replace(/\.[^.]+$/, "").trim() || "audio";
  return `${base}-cut.${mode === "copy" ? "m4a" : "wav"}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
