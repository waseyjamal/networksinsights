// Pure logic of "Audio Joiner": the file rules, the format of the joined file, matching each clip
// to it, and writing the WAV, with no DOM, no network and no top-level statements
// (docs/tool-contract.md). worker.ts decodes each clip with Mediabunny (ADR 0061) and hands the
// samples here.
//
// The joined file takes the highest sample rate and the most channels (one or two) of its clips,
// so a clip is only ever resampled up, never down, and a mono clip is played on both channels of
// a stereo file. Resampling up is linear interpolation between neighbouring samples.

export const LIMITS = {
  /** 200 MB per clip. */
  maxInputBytes: 200 * 1024 * 1024,
  maxFiles: 20,
  /** The joined file is at most 20 minutes long: it is built in memory. */
  maxTotalSeconds: 20 * 60,
  maxChannels: 2,
} as const;

/** Kept for the manifest's input schema: the order is the order of the list. */
export interface Input {
  order: number[];
}

export interface ClipInfo {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  codec: string | null;
}

export type Job =
  | { kind: "probe"; file: Blob }
  | { kind: "join"; files: Blob[]; sampleRate: number; channels: number };

export type JobResult =
  | { kind: "probe"; clip: ClipInfo }
  | { kind: "join"; blob: Blob; durationMs: number; sampleRate: number; channels: number };

export const MESSAGES = {
  notAudio:
    "This file is not a recording this tool can open. Choose a WAV, M4A, MP3, OGG or FLAC file.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooMany: `Join at most ${LIMITS.maxFiles} recordings at a time.`,
  unreadable: "This recording could not be read. It may be damaged.",
  noAudio: "This file has no sound to join.",
  cannotDecode: (codec: string) =>
    `This browser cannot decode ${codec} sound, so this file cannot be joined here. WAV files work in every browser.`,
  tooManyChannels: (channels: number) =>
    `This recording has ${channels} channels. Only mono and stereo recordings can be joined.`,
  tooLong: "Together the recordings are longer than 20 minutes. Remove one or join them in parts.",
  needTwo: "Add at least two recordings to join.",
  failed: "The recordings could not be joined.",
} as const;

const TYPES = [
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mp4",
  "audio/x-m4a",
  "audio/mpeg",
  "audio/ogg",
  "audio/flac",
  "audio/x-flac",
];

export function checkFile(file: { name: string; type: string; size: number }): string | undefined {
  const known =
    TYPES.includes(file.type) || /\.(wav|m4a|mp4|aac|mp3|ogg|oga|opus|flac)$/i.test(file.name);
  if (!known) return MESSAGES.notAudio;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return;
}

/** A clip the tool cannot join, or undefined when it can. */
export function checkClip(clip: ClipInfo): string | undefined {
  if (clip.channels < 1) return MESSAGES.noAudio;
  if (clip.channels > LIMITS.maxChannels) return MESSAGES.tooManyChannels(clip.channels);
  return;
}

/** The sample rate and channels of the joined file: the highest of the clips. */
export function targetFormat(clips: readonly ClipInfo[]): { sampleRate: number; channels: number } {
  let sampleRate = 0;
  let channels = 1;
  for (const clip of clips) {
    sampleRate = Math.max(sampleRate, clip.sampleRate);
    channels = Math.max(channels, Math.min(LIMITS.maxChannels, clip.channels));
  }
  return { sampleRate, channels };
}

/** Whether the joined file would pass the length limit. */
export function tooLong(clips: readonly ClipInfo[]): boolean {
  return clips.reduce((sum, clip) => sum + clip.durationSeconds, 0) > LIMITS.maxTotalSeconds;
}

/** How many frames `frames` at `from` Hz last at `to` Hz. */
export function resampledLength(frames: number, from: number, to: number): number {
  return from === to ? frames : Math.round((frames * to) / from);
}

/** One channel at `from` Hz as `to` Hz (to ≥ from), by linear interpolation. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const length = resampledLength(samples.length, from, to);
  const out = new Float32Array(length);
  const step = from / to;
  const last = samples.length - 1;
  for (let i = 0; i < length; i++) {
    const at = i * step;
    const index = Math.floor(at);
    const a = samples[Math.min(index, last)] ?? 0;
    const b = samples[Math.min(index + 1, last)] ?? 0;
    out[i] = a + (b - a) * (at - index);
  }
  return out;
}

/**
 * A clip's channels as the joined file's: mono becomes the same sound on every channel; stereo
 * into stereo stays as it is.
 */
export function matchChannels(planes: readonly Float32Array[], channels: number): Float32Array[] {
  const first = planes[0] ?? new Float32Array(0);
  return Array.from({ length: channels }, (_, index) => planes[index] ?? first);
}

/** Interleaved 16-bit samples, little-endian, as a WAV `data` chunk holds them. */
export function toPcm16(planes: readonly Float32Array[]): Uint8Array {
  const frames = planes[0]?.length ?? 0;
  const channels = planes.length;
  const bytes = new Uint8Array(frames * channels * 2);
  const view = new DataView(bytes.buffer);
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const value = Math.max(-1, Math.min(1, planes[channel]?.[frame] ?? 0));
      view.setInt16(
        (frame * channels + channel) * 2,
        Math.round(value < 0 ? value * 32768 : value * 32767),
        true,
      );
    }
  }
  return bytes;
}

/** The 44-byte header of a 16-bit PCM WAV file holding `dataBytes` of samples. */
export function wavHeader(dataBytes: number, sampleRate: number, channels: number): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) header[at + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  return header;
}

/** `intro.wav` first in the list gives `intro-joined.wav`. */
export function outputName(firstName: string): string {
  const base = firstName.replace(/\.[^.]+$/, "").trim() || "audio";
  return `${base}-joined.wav`;
}

/** Moves the entry at `index` by `by` places. */
export function move<T>(list: readonly T[], index: number, by: number): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return [...list];
  const copy = [...list];
  copy.splice(to, 0, ...copy.splice(index, 1));
  return copy;
}

export function channelLabel(channels: number): string {
  return channels === 1 ? "mono" : channels === 2 ? "stereo" : `${channels} channels`;
}

/** 0:02, 1:05. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
