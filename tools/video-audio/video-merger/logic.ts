// Pure logic of "Video Merger": the file rules, the limits, the size of the joined video, which
// containers the browser can write, the order of the clips, and the sound's resampling to one rate,
// with no DOM, no network and no top-level statements (docs/tool-contract.md). worker.ts decodes and
// encodes with Mediabunny and the browser's WebCodecs (ADR 0061).

/** The limits the manifest declares and the page enforces: one source for both. Our own choices. */
export const LIMITS = {
  /** 500 MB per clip, read in pieces. */
  maxInputBytes: 500 * 1024 * 1024,
  /** Ten clips at a time. */
  maxFiles: 10,
  /** At least two clips: one clip has nothing to join. */
  minFiles: 2,
  /** Ten minutes in all, in milliseconds: the joined video is built in memory. */
  maxTotalMs: 10 * 60 * 1000,
  /** The joined video fits inside 1920 by 1080 (or 1080 by 1920 when the first clip is upright). */
  maxLongSide: 1920,
  maxShortSide: 1080,
} as const;

/** The sound of the joined video: 48 kHz stereo, whatever each clip had. */
export const AUDIO_RATE = 48_000;
export const AUDIO_CHANNELS = 2;
export const AUDIO_BITRATE = 128_000;

export const CONTAINERS = {
  mp4: {
    label: "MP4 (H.264 and AAC)",
    extension: "mp4",
    mime: "video/mp4",
    audio: { codec: "aac", webcodecs: "mp4a.40.2" },
    video: [
      { codec: "avc", webcodecs: "avc1.640028" },
      { codec: "avc", webcodecs: "avc1.4d0028" },
      { codec: "avc", webcodecs: "avc1.42e028" },
    ],
  },
  webm: {
    label: "WebM (VP9 or VP8, and Opus)",
    extension: "webm",
    mime: "video/webm",
    audio: { codec: "opus", webcodecs: "opus" },
    video: [
      { codec: "vp9", webcodecs: "vp09.00.40.08" },
      { codec: "vp8", webcodecs: "vp8" },
    ],
  },
} as const;

export type Container = keyof typeof CONTAINERS;

/** Kept for the manifest's input schema: the choice a visitor makes. */
export interface Input {
  container: Container;
}

/** The part of a WebCodecs decoder config the page passes back to the browser. */
export interface DecoderConfigLike {
  codec: string;
  description?: unknown;
  sampleRate?: number;
  numberOfChannels?: number;
}

/** What the worker found in one clip. */
export interface Probe {
  durationSeconds: number;
  width: number;
  height: number;
  videoConfig: DecoderConfigLike | null;
  audioConfig: DecoderConfigLike | null;
  /** True for raw PCM sound, which Mediabunny reads with no decoder. */
  pcmAudio: boolean;
}

/** The encoders the page found for one container. */
export interface Encoders {
  container: Container;
  video: string;
  audio: string | null;
}

export type Job =
  | { kind: "probe"; file: Blob }
  | {
      kind: "merge";
      files: Blob[];
      container: Container;
      /** Mediabunny's codec names, such as "avc" and "aac". Audio is null when no clip has sound. */
      video: string;
      audio: string | null;
      /** Per clip: whether the page found that the browser decodes its sound. */
      sound: boolean[];
      width: number;
      height: number;
    };

export type JobResult =
  | { kind: "probe"; probe: Probe }
  | { kind: "merge"; blob: Blob; durationMs: number; width: number; height: number };

export const MESSAGES = {
  notVideo: "This file is not a video this tool reads. Choose an MP4, MOV or WebM file.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooMany: `Up to ${LIMITS.maxFiles} clips can be joined at a time.`,
  noVideo: "This file has no video track.",
  unreadable:
    "This file could not be read. It may be damaged, or use a format this tool cannot open.",
  tooFew: `Add at least ${LIMITS.minFiles} clips to join.`,
  tooLong: (total: string) =>
    `These clips last ${total} in all. The joined video can be at most ${LIMITS.maxTotalMs / 60_000} minutes long: remove a clip.`,
  cannotDecode:
    "Your browser cannot decode this clip, so it cannot be joined here. Remove it, or try a recent Chrome or Edge on a computer.",
  cannotEncode:
    "Your browser cannot encode video, so it cannot join clips. A recent Chrome or Edge on a computer can.",
  stillReading: "Wait until every clip has been read.",
  clipProblem: (index: number, name: string) =>
    `Clip ${index}, ${name}, cannot be joined here. Remove it to join the others.`,
  failed: "The browser could not write the joined video.",
} as const;

const TYPES = ["video/mp4", "video/webm", "video/quicktime"];

export function checkFile(file: { name: string; type: string; size: number }): string | undefined {
  const known = TYPES.includes(file.type) || /\.(mp4|m4v|webm|mov)$/i.test(file.name);
  if (!known) return MESSAGES.notVideo;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return;
}

/** How many more clips fit in the list. */
export function room(count: number): number {
  return Math.max(0, LIMITS.maxFiles - count);
}

/** Checks the whole list before joining: enough clips, and not too long in all. */
export function checkList(durationsMs: readonly number[]): string | undefined {
  if (durationsMs.length < LIMITS.minFiles) return MESSAGES.tooFew;
  const total = durationsMs.reduce((sum, ms) => sum + ms, 0);
  if (total > LIMITS.maxTotalMs) return MESSAGES.tooLong(formatTime(total));
  return;
}

/** A clip's length in whole milliseconds, rounded to the nearest. */
export function durationMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

/** Moves the item at `index` by `by` places, if it can move. Returns a new list. */
export function move<T>(items: readonly T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (typeof item !== "undefined") next.splice(target, 0, item);
  return next;
}

/**
 * The size of the joined video: the first clip's size, scaled down (never up) to fit inside
 * 1920 by 1080, or 1080 by 1920 for an upright clip, then rounded down to even numbers, which
 * every encoder takes. Other clips are fitted inside it with black bars.
 */
export function outputSize(width: number, height: number): { width: number; height: number } {
  const upright = height > width;
  const maxWidth = upright ? LIMITS.maxShortSide : LIMITS.maxLongSide;
  const maxHeight = upright ? LIMITS.maxLongSide : LIMITS.maxShortSide;
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  const even = (value: number) => Math.max(2, Math.floor((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** Mixes any number of channels to stereo: mono is copied to both sides, extra channels dropped. */
export function toStereo(planes: readonly Float32Array[]): [Float32Array, Float32Array] {
  const left = planes[0] ?? new Float32Array(0);
  const right = planes[1] ?? left;
  return [left, right];
}

/**
 * A linear resampler that keeps its place between pieces, so pieces played back to back join
 * without a gap. Each call takes one piece of stereo sound at `from` Hz and gives it at `to` Hz.
 */
export function createResampler(from: number, to: number) {
  const step = from / to;
  // The position of the next output sample, in input samples from the start of the next piece.
  // Between -1 and 0 it falls between the last sample of the previous piece and the first of this.
  let position = 0;
  let last: [number, number] = [0, 0];
  return (planes: readonly [Float32Array, Float32Array]): [Float32Array, Float32Array] => {
    const [left, right] = planes;
    const length = left.length;
    if (length === 0) return [new Float32Array(0), new Float32Array(0)];
    const count = Math.max(0, Math.ceil((length - 1 - position) / step));
    const outLeft = new Float32Array(count);
    const outRight = new Float32Array(count);
    for (let index = 0; index < count; index++) {
      const at = position + index * step;
      const whole = Math.floor(at);
      const fraction = at - whole;
      const leftA = whole < 0 ? last[0] : (left[whole] ?? 0);
      const rightA = whole < 0 ? last[1] : (right[whole] ?? 0);
      const leftB = left[whole + 1] ?? leftA;
      const rightB = right[whole + 1] ?? rightA;
      outLeft[index] = leftA + (leftB - leftA) * fraction;
      outRight[index] = rightA + (rightB - rightA) * fraction;
    }
    position += count * step - length;
    last = [left[length - 1] ?? 0, right[length - 1] ?? 0];
    return [outLeft, outRight];
  };
}

/** Stereo planes as one buffer, left then right, as an "f32-planar" audio sample holds them. */
export function planar(left: Float32Array, right: Float32Array): Float32Array {
  const out = new Float32Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

/** The sound frames a clip of `seconds` takes at the output rate. */
export function framesFor(seconds: number): number {
  return Math.round(seconds * AUDIO_RATE);
}

/** `holiday.mov` becomes `holiday-joined.mp4`. */
export function outputName(firstName: string | undefined, container: Container): string {
  const base = (firstName ?? "").replace(/\.[^.]+$/, "").trim() || "video";
  return `${base}-joined.${CONTAINERS[container].extension}`;
}

/** Milliseconds as `m:ss.sss`, without trailing zeros in the fraction. */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const fraction = total % 1000;
  const seconds = Math.floor(total / 1000) % 60;
  const minutes = Math.floor(total / 60_000);
  const tail = fraction ? `.${String(fraction).padStart(3, "0").replace(/0+$/, "")}` : "";
  return `${minutes}:${String(seconds).padStart(2, "0")}${tail}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
