// Pure logic of "Mute Video": the file rules, the container the muted copy is written in and its
// name, with no DOM, no network and no top-level statements (docs/tool-contract.md). worker.ts
// copies the video track with Mediabunny and leaves the sound out (ADR 0061); nothing is decoded
// or encoded, so no codec of the browser is needed.

export const LIMITS = {
  /** 500 MB per file. The new file is built in memory. */
  maxInputBytes: 500 * 1024 * 1024,
  maxFiles: 1,
} as const;

/** The muted copy is written in the same kind of container as the original. */
export const CONTAINERS = {
  mp4: { extension: "mp4", mime: "video/mp4", label: "MP4" },
  mov: { extension: "mov", mime: "video/quicktime", label: "MOV" },
  webm: { extension: "webm", mime: "video/webm", label: "WebM" },
  mkv: { extension: "mkv", mime: "video/x-matroska", label: "MKV" },
} as const;

export type Container = keyof typeof CONTAINERS;

/** Kept for the manifest's input schema: the tool has no options. */
export type Input = Record<string, never>;

export interface Probe {
  container: Container;
  durationSeconds: number;
  videoCodec: string | null;
  width: number;
  height: number;
  hasAudio: boolean;
  /** How many audio tracks the file has; all of them are left out. */
  audioTracks: number;
}

export type Job = { kind: "probe"; file: Blob } | { kind: "mute"; file: Blob };

export type JobResult =
  | { kind: "probe"; probe: Probe }
  | { kind: "mute"; blob: Blob; durationMs: number; container: Container };

export const MESSAGES = {
  notVideo: "This file is not a video this tool can open. Choose an MP4, MOV, WebM or MKV file.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  unreadable:
    "This video could not be read. It may be damaged or in a format the tool cannot open.",
  noVideo: "This file has no video track.",
  noAudio: "No audio track found: this video is already silent, so there is nothing to remove.",
  cannotCopy:
    "The video track could not be copied into a new file of the same kind, so nothing was saved. The tool never re-encodes.",
  failed: "The video could not be muted.",
} as const;

/** Mediabunny's format name to the container of the muted copy. */
export function containerFor(formatName: string): Container {
  if (/webm/i.test(formatName)) return "webm";
  if (/matroska/i.test(formatName)) return "mkv";
  if (/quicktime/i.test(formatName)) return "mov";
  return "mp4";
}

const TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"];

export function checkFile(file: { name: string; type: string; size: number }): string | undefined {
  const known = TYPES.includes(file.type) || /\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name);
  if (!known) return MESSAGES.notVideo;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return;
}

/** `holiday.MOV` muted as MOV becomes `holiday-muted.mov`. */
export function outputName(inputName: string, container: Container): string {
  const base = inputName.replace(/\.[^.]+$/, "").trim() || "video";
  return `${base}-muted.${CONTAINERS[container].extension}`;
}

/** 0:02, 1:05, 1:00:00. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
