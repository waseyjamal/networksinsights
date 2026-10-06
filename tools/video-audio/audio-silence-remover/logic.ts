// Pure logic of "Audio Silence Remover": the file rules, finding silence by a threshold and a
// minimum length, what is kept, the peak normalising and the WAV writer, with no DOM, no network
// and no top-level statements (docs/tool-contract.md). worker.ts decodes the sound with Mediabunny
// (ADR 0061) and encodes M4A or OGG with the browser's WebCodecs where it can.

export const LIMITS = {
  /** 100 MB per file: our own choice. */
  maxInputBytes: 100 * 1024 * 1024,
  maxFiles: 1,
  /** Ten minutes of sound, our own choice: the whole recording is held in memory, decoded. */
  maxDurationMs: 10 * 60 * 1000,
} as const;

export const RANGES = {
  /** Sound quieter than this, in dB below full scale, counts as silence. */
  threshold: { min: -70, max: -20 },
  /** Silence shorter than this, in seconds, is kept as it is. */
  minSilence: { min: 0.3, max: 10 },
} as const;

export const DEFAULTS = { threshold: -45, minSilence: 0.5 } as const;

/** A long pause inside the recording is shortened to this, in seconds: our own choice. */
export const KEPT_PAUSE = 0.25;
/** The loudest sample after normalising, in dB below full scale: our own choice. */
export const PEAK_TARGET_DB = -1;
/** Silence is judged in windows of this many seconds. */
export const WINDOW = 0.01;

export const OUTPUTS = {
  wav: { label: "WAV (16-bit)", extension: "wav", mime: "audio/wav" },
  m4a: { label: "M4A (AAC)", extension: "m4a", mime: "audio/mp4" },
  ogg: { label: "OGG (Opus)", extension: "ogg", mime: "audio/ogg" },
} as const;

export type OutputId = keyof typeof OUTPUTS;

/** Kept for the manifest's input schema: the choices a visitor makes. */
export interface Input {
  threshold: number;
  minSilence: number;
  normalize: boolean;
  output: OutputId;
}

/** The part of a WebCodecs AudioDecoderConfig the page passes back to the browser. */
export interface AudioDecoderConfigLike {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: unknown;
}

export interface Probe {
  durationSeconds: number;
  codec: string | null;
  sampleRate: number;
  channels: number;
  decoderConfig: AudioDecoderConfigLike | null;
}

export type Job =
  | { kind: "probe"; file: Blob }
  | {
      kind: "clean";
      file: Blob;
      threshold: number;
      minSilence: number;
      normalize: boolean;
      output: OutputId;
    };

export interface Report {
  beforeSeconds: number;
  afterSeconds: number;
  /** The gain applied by normalising, in dB; 0 when it was off. */
  gainDb: number;
}

export type JobResult = { kind: "probe"; probe: Probe } | ({ kind: "clean"; blob: Blob } & Report);

export const MESSAGES = {
  notAudio: "This file is not a recording this tool reads. Choose a WAV, M4A, OGG or WebM file.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooLong: "This recording is longer than 10 minutes. Cut it into shorter parts first.",
  noAudio: "This file has no sound track.",
  unreadable:
    "This file could not be read. It may be damaged, or use a format this tool cannot open.",
  cannotDecode:
    "Your browser cannot decode this recording, so it cannot be cleaned here. A recent Chrome or Edge on a computer decodes the most formats.",
  allSilent:
    "The whole recording is quieter than the threshold. Lower the threshold, for example to -60 dB, and try again.",
  range: (label: string, min: number, max: number, unit: string) =>
    `${label} must be from ${min} to ${max} ${unit}.`,
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

export function checkFile(file: { name: string; type: string; size: number }): string | undefined {
  const known =
    MEDIA_TYPES.has(file.type.toLowerCase()) ||
    ((file.type === "" || file.type === "application/octet-stream") &&
      /\.(wav|wave|ogg|oga|opus|m4a|weba|webm)$/i.test(file.name));
  if (!known) return MESSAGES.notAudio;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return;
}

/** Refuses a recording longer than ten minutes; exactly ten is fine. */
export function checkLength(durationSeconds: number): string | undefined {
  if (Math.round(durationSeconds * 1000) > LIMITS.maxDurationMs) return MESSAGES.tooLong;
  return;
}

export function checkSettings(threshold: number, minSilence: number) {
  const errors: Partial<Record<"threshold" | "minSilence", string>> = {};
  const t = RANGES.threshold;
  if (!Number.isFinite(threshold) || threshold < t.min || threshold > t.max) {
    errors.threshold = MESSAGES.range("Threshold", t.min, t.max, "dB");
  }
  const m = RANGES.minSilence;
  if (!Number.isFinite(minSilence) || minSilence < m.min || minSilence > m.max) {
    errors.minSilence = MESSAGES.range("Shortest silence", m.min, m.max, "seconds");
  }
  return errors;
}

/** Whether a codec is raw PCM, which Mediabunny reads with no decoder. */
export function isPcm(codec: string | null): boolean {
  return codec?.startsWith("pcm-") ?? false;
}

export const dbToGain = (db: number) => 10 ** (db / 20);

/** A stretch of samples, from `start` up to but not including `end`. */
export interface Span {
  start: number;
  end: number;
}

/**
 * The parts to keep. The sound is judged in 10 ms windows: a window is silent when no sample in
 * any channel is louder than the threshold. Silence at the start and the end is dropped; a silent
 * run inside at least `minSilence` long is cut down to KEPT_PAUSE, half from each side.
 */
export function keptSpans(
  planes: readonly Float32Array[],
  sampleRate: number,
  thresholdDb: number,
  minSilence: number,
): Span[] {
  const length = planes[0]?.length ?? 0;
  const window = Math.max(1, Math.round(sampleRate * WINDOW));
  const level = dbToGain(thresholdDb);
  const loud: boolean[] = [];
  for (let start = 0; start < length; start += window) {
    const end = Math.min(length, start + window);
    let isLoud = false;
    for (const plane of planes) {
      for (let i = start; i < end && !isLoud; i++)
        if (Math.abs(plane[i] ?? 0) > level) isLoud = true;
      if (isLoud) break;
    }
    loud.push(isLoud);
  }
  const first = loud.indexOf(true);
  if (first < 0) return [];
  const last = loud.lastIndexOf(true);
  const minWindows = Math.round(minSilence / WINDOW);
  const keepHalf = Math.round((KEPT_PAUSE * sampleRate) / 2);
  const spans: Span[] = [];
  let spanStart = first * window;
  let index = first;
  while (index <= last) {
    if (loud[index]) {
      index++;
      continue;
    }
    let runEnd = index;
    while (runEnd <= last && !loud[runEnd]) runEnd++;
    if (runEnd - index >= minWindows) {
      spans.push({ start: spanStart, end: index * window + keepHalf });
      spanStart = runEnd * window - keepHalf;
    }
    index = runEnd;
  }
  spans.push({ start: spanStart, end: Math.min(length, (last + 1) * window) });
  return spans;
}

/** The kept parts joined, per channel. */
export function joinSpans(planes: readonly Float32Array[], spans: readonly Span[]): Float32Array[] {
  const total = spans.reduce((sum, span) => sum + (span.end - span.start), 0);
  return planes.map((plane) => {
    const out = new Float32Array(total);
    let at = 0;
    for (const span of spans) {
      out.set(plane.subarray(span.start, span.end), at);
      at += span.end - span.start;
    }
    return out;
  });
}

/** The gain, in dB, that brings the loudest sample to PEAK_TARGET_DB. 0 for silence. */
export function peakGainDb(planes: readonly Float32Array[]): number {
  let peak = 0;
  for (const plane of planes) for (const value of plane) peak = Math.max(peak, Math.abs(value));
  if (peak === 0) return 0;
  return PEAK_TARGET_DB - 20 * Math.log10(peak);
}

/** Multiplies every sample by a gain in dB, in place. */
export function applyGain(planes: Float32Array[], gainDb: number): void {
  const gain = dbToGain(gainDb);
  for (const plane of planes)
    for (let i = 0; i < plane.length; i++) plane[i] = (plane[i] ?? 0) * gain;
}

/** A 16-bit PCM WAV file of the planes. */
export function wavBytes(planes: readonly Float32Array[], sampleRate: number): Uint8Array {
  const channels = planes.length;
  const frames = planes[0]?.length ?? 0;
  const dataBytes = frames * channels * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  let at = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (const plane of planes) {
      const value = Math.max(-1, Math.min(1, plane[frame] ?? 0));
      view.setInt16(at, Math.round(value < 0 ? value * 0x8000 : value * 0x7fff), true);
      at += 2;
    }
  }
  return bytes;
}

/** `talk.m4a` becomes `talk-trimmed.wav`, in the format chosen. */
export function outputName(inputName: string, output: OutputId): string {
  const base = inputName.replace(/\.[^.]+$/, "").trim() || "audio";
  return `${base}-trimmed.${OUTPUTS[output].extension}`;
}

export function formatSeconds(seconds: number): string {
  return `${Math.round(seconds * 100) / 100} s`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
