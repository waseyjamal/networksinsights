// Pure logic of "Video Trimmer": the file rules, reading times such as 1:05.5, checking the cut,
// which modes the visitor's browser can do, and the output names, with no DOM, no network and no
// top-level statements (docs/tool-contract.md, "logic.ts: what pure means"). worker.ts cuts with
// Mediabunny (ADR 0061); ui.tsx asks the browser with WebCodecs what it can encode.

/** The limits the manifest declares and the page enforces: one source for both. */
export const LIMITS = {
  /** 500 MB per file. The new file is built in memory. */
  maxInputBytes: 500 * 1024 * 1024,
  maxFiles: 1,
  /** The shortest cut, in milliseconds. Our own choice. */
  minCutMs: 100,
} as const;

/**
 * Fast copies the encoded video as it is, so the cut can only start on a key frame: it starts at
 * the last key frame at or before the chosen start. Exact decodes and encodes the video again, so
 * it starts on the chosen frame.
 */
export const MODES = {
  fast: "Fast: keyframe cut, no re-encoding",
  exact: "Exact: frame-exact cut, re-encodes the video",
} as const;

export type Mode = keyof typeof MODES;

export const CONTAINERS = {
  mp4: { extension: "mp4", mime: "video/mp4", label: "MP4" },
  webm: { extension: "webm", mime: "video/webm", label: "WebM" },
} as const;

export type Container = keyof typeof CONTAINERS;

/** H.264 for MP4 (High, Main, Baseline at level 4.0), VP9 then VP8 for WebM, as WebCodecs names them. */
export const ENCODER_CODECS = {
  mp4: [
    { codec: "avc", webcodecs: "avc1.640028" },
    { codec: "avc", webcodecs: "avc1.4d0028" },
    { codec: "avc", webcodecs: "avc1.42e028" },
  ],
  webm: [
    { codec: "vp9", webcodecs: "vp09.00.40.08" },
    { codec: "vp8", webcodecs: "vp8" },
  ],
} as const;

/** Kept for the manifest's input schema: the choices a visitor makes. */
export interface Input {
  start: string;
  end: string;
  mode: Mode;
}

/** The part of a WebCodecs decoder config the page passes back to the browser. */
export interface DecoderConfigLike {
  codec: string;
  description?: unknown;
  [key: string]: unknown;
}

/** What the worker found in the video. */
export interface Probe {
  durationSeconds: number;
  container: Container;
  video: {
    codec: string | null;
    width: number;
    height: number;
    decoderConfig: DecoderConfigLike | null;
  } | null;
  hasAudio: boolean;
}

export type Job =
  | { kind: "probe"; file: Blob }
  | {
      kind: "trim";
      file: Blob;
      startMs: number;
      endMs: number;
      mode: Mode;
      /** Mediabunny's codec name for an exact cut, such as "avc". */
      codec: string | null;
    };

export type JobResult =
  | { kind: "probe"; probe: Probe }
  | {
      kind: "trim";
      blob: Blob;
      /** Where the cut really starts in the source, in milliseconds (a key frame for Fast). */
      startMs: number;
      /** The length of the new file, in milliseconds, read back from it. */
      durationMs: number;
    };

export const MESSAGES = {
  notVideo: "This file is not a video this tool reads. Choose an MP4, MOV or WebM file.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  noVideo: "This file has no video track.",
  unreadable:
    "This file could not be read. It may be damaged, or use a format this tool cannot open.",
  badTime: (which: "start" | "end") =>
    `Write the ${which} as seconds, such as 12.5, or as minutes and seconds, such as 1:05.`,
  order: "The end must come after the start.",
  tooShort: `The cut must be at least ${LIMITS.minCutMs / 1000} seconds long.`,
  pastEnd: (duration: string) => `The video is only ${duration} long.`,
  noExact:
    "Your browser cannot decode and encode this video, so only the fast keyframe cut is offered here. A recent Chrome or Edge on a computer can do both.",
  cannotCopy: "This video cannot be cut without re-encoding, and your browser cannot re-encode it.",
  failed: "The browser could not write the video.",
} as const;

/** Mediabunny's container for an input file: WebM stays WebM, MP4 and MOV become MP4. */
export function containerFor(formatName: string): Container {
  return /webm|matroska/i.test(formatName) ? "webm" : "mp4";
}

const TYPES = ["video/mp4", "video/webm", "video/quicktime"];

export function checkFile(file: { name: string; type: string; size: number }): string | undefined {
  const known = TYPES.includes(file.type) || /\.(mp4|m4v|webm|mov)$/i.test(file.name);
  if (!known) return MESSAGES.notVideo;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
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

/** A length in seconds for a sentence, such as "2.5 seconds". */
export function formatSeconds(ms: number): string {
  const seconds = Math.round(ms / 100) / 10;
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

/** Checks the start and end against each other and the video's length. */
export function checkCut(
  start: string,
  end: string,
  durationMs: number,
): { ok: true; startMs: number; endMs: number } | { ok: false; error: string } {
  const startMs = parseTime(start);
  if (typeof startMs === "undefined") return { ok: false, error: MESSAGES.badTime("start") };
  const endMs = parseTime(end);
  if (typeof endMs === "undefined") return { ok: false, error: MESSAGES.badTime("end") };
  if (endMs <= startMs) return { ok: false, error: MESSAGES.order };
  if (endMs > durationMs) return { ok: false, error: MESSAGES.pastEnd(formatTime(durationMs)) };
  if (endMs - startMs < LIMITS.minCutMs) return { ok: false, error: MESSAGES.tooShort };
  return { ok: true, startMs, endMs };
}

/** The video's length in whole milliseconds, rounded down so the end field never passes it. */
export function durationMs(seconds: number): number {
  return Math.floor(seconds * 1000 + 1e-6);
}

/** `talk.mov` becomes `talk-trimmed.mp4`. */
export function outputName(inputName: string, container: Container): string {
  const base = inputName.replace(/\.[^.]+$/, "").trim() || "video";
  return `${base}-trimmed.${CONTAINERS[container].extension}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
