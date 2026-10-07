// Pure logic of "Speech to Text": the file and length rules, the model files and their hashes, the
// joining of the decoder's two parts, the sound turned into 16 kHz mono and cut into 30-second
// windows, Whisper's log-mel features, the choice of the next token and the tokens turned back into
// text, with no DOM, no network and no top-level statements (docs/tool-contract.md). worker.ts
// decodes the recording with Mediabunny (ADR 0061) and runs Whisper tiny with ONNX Runtime Web
// (ADR 0066); the decoder is served in two parts because no file may pass 25 MiB (ADR 0068).

import { safeFilename } from "@networksinsights/tool-sdk/download";

export const LIMITS = {
  /** 100 MB per file: our own choice, far above three minutes of any format this tool reads. */
  maxInputBytes: 100 * 1024 * 1024,
  /** Three minutes of sound: six windows, our own choice (ADR 0068). */
  maxSeconds: 180,
} as const;

/** Whisper hears 16,000 samples a second, in windows of 30 seconds. */
export const SAMPLE_RATE = 16_000;
export const WINDOW_SECONDS = 30;
export const WINDOW_SAMPLES = SAMPLE_RATE * WINDOW_SECONDS;
/** A last window shorter than this, after a full one, holds no word worth the work. */
export const MIN_TAIL_SAMPLES = SAMPLE_RATE / 5;
/** A window whose loudest sample is quieter than this is silence: it is not sent to the model. */
export const SILENCE_PEAK = 0.001;

/** Whisper's feature settings (preprocessor_config.json of the model). */
export const MEL = { bins: 80, fft: 400, hop: 160, frames: 3000 } as const;

/** The tokens of Whisper's multilingual vocabulary this tool uses (config.json of the model). */
export const TOKENS = {
  endOfText: 50_257,
  startOfTranscript: 50_258,
  english: 50_259,
  transcribe: 50_359,
  noTimestamps: 50_363,
} as const;

/** The prompt of every window: English, transcribe, no timestamps. */
export const PROMPT = [
  TOKENS.startOfTranscript,
  TOKENS.english,
  TOKENS.transcribe,
  TOKENS.noTimestamps,
] as const;

/** At most this many tokens a window: half of Whisper's 448, which a window of speech never needs. */
export const MAX_TOKENS = 224;

/** Whisper tiny's decoder: 4 layers of 6 heads of 64 values each, as the cache tensors are shaped. */
export const DECODER_SHAPE = { heads: 6, headSize: 64 } as const;

export interface ModelFile {
  url: string;
  sha256: string;
  bytes: number;
}

/**
 * Whisper tiny from Xenova/whisper-tiny at 5332fcc3 (Apache-2.0), served from this site with the
 * start of each file's SHA-256 in its path (ADR 0066, ADR 0068). Kept in step with
 * apps/web/src/config/models.ts and the files by a test.
 */
export const MODEL = {
  encoder: {
    url: "/models/whisper-tiny-en/fd9d995b9dcb0520/encoder_model_quantized.onnx",
    sha256: "fd9d995b9dcb0520f0dbf6cf68651af639fc385f594d9d876e69ca2802dc438e",
    bytes: 10_124_910,
  },
  decoderParts: [
    {
      url: "/models/whisper-tiny-en/e09cb762fffb6116/decoder_model_merged_quantized.onnx.part1",
      sha256: "e09cb762fffb6116917f4e9997596670aac8e0f6e15ae4afa3fd0bd37969ca63",
      bytes: 15_363_883,
    },
    {
      url: "/models/whisper-tiny-en/9ad7f59107d1822b/decoder_model_merged_quantized.onnx.part2",
      sha256: "9ad7f59107d1822b42ac67e07f1c3fc0a366d5738b44caa191a1a8f7f18ed7ea",
      bytes: 15_363_882,
    },
  ],
  /** The decoder the two parts make, byte for byte as published. */
  decoder: {
    sha256: "6c0c125986b007d2e3734bec84c18bda0152071b90b87fadac6d7764499927a0",
    bytes: 30_727_765,
  },
  vocab: {
    url: "/models/whisper-tiny-en/50d6a919f0a0601d/vocab.json",
    sha256: "50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a",
    bytes: 1_036_584,
  },
} as const satisfies Record<string, unknown>;

/** The files the model download fetches, in order. */
export const modelFiles = (): ModelFile[] => [MODEL.encoder, ...MODEL.decoderParts, MODEL.vocab];

/** What the download button fetches: the model, without the engine. */
export const modelBytes = () => modelFiles().reduce((sum, file) => sum + file.bytes, 0);

export const ENGINE = {
  base: "/vendor/onnxruntime-web/1.30.0/",
  mjs: "ort-wasm-simd-threaded.mjs",
  wasm: "ort-wasm-simd-threaded.wasm",
  /** Both files together, as served. */
  bytes: 14_264_278,
} as const;

/** Kept for the manifest's input schema: the visitor makes no choice but the recording. */
export type Input = Record<string, never>;

export interface Probe {
  durationSeconds: number;
}

export type Job =
  | { kind: "status" }
  | { kind: "probe"; file: Blob }
  | { kind: "transcribe"; file: Blob };

export type JobResult =
  | { kind: "status"; loaded: boolean }
  | { kind: "probe"; probe: Probe }
  | { kind: "transcribe"; text: string; windows: number; durationSeconds: number };

export const MESSAGES = {
  notAudio:
    "This file is not a recording this tool reads. Choose a WAV, MP3, M4A, OGG or WebM file.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooLong: (seconds: number) =>
    `This recording is ${formatSeconds(seconds)} long. The limit is 3 minutes: cut it into shorter parts first.`,
  noAudio: "This file has no sound track.",
  unreadable:
    "This file could not be read. It may be damaged, or use a format this tool cannot open.",
  cannotDecode:
    "Your browser cannot decode this recording. Try a WAV file, or a recent Chrome or Edge on a computer.",
  modelFailed:
    "The model could not be downloaded, or a file did not match its checksum. Nothing was kept. Check your connection, then try again.",
  outOfMemory:
    "This device ran out of memory while running the model. Close other tabs and try again, or use a computer.",
  silent: "No speech was found in this recording.",
  failed: "The recording could not be transcribed.",
} as const;

const MEDIA_TYPES = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/opus",
  "audio/mp4",
  "audio/x-m4a",
  "audio/webm",
]);

/** Null when the file can be tried, or why not. */
export function checkFile(file: { name: string; type: string; size: number }): string | null {
  const known =
    MEDIA_TYPES.has(file.type.toLowerCase()) ||
    ((file.type === "" || file.type === "application/octet-stream") &&
      /\.(wav|wave|mp3|ogg|oga|opus|m4a|weba|webm)$/i.test(file.name));
  if (!known) return MESSAGES.notAudio;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return null;
}

/** Null when the recording fits in three minutes (exactly three is fine), or the message. */
export function checkDuration(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return MESSAGES.unreadable;
  if (Math.round(seconds * 1000) > LIMITS.maxSeconds * 1000) return MESSAGES.tooLong(seconds);
  return null;
}

/** Lowercase hex of a digest. */
export function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** True when a file has the stated size and SHA-256 (hex, any case). */
export function matches(file: { sha256: string; bytes: number }, length: number, hex: string) {
  return length === file.bytes && hex.toLowerCase() === file.sha256;
}

/** Where a file of `total` bytes is cut into `count` parts: the first parts take the extra byte. */
export function splitPoints(total: number, count: number): number[] {
  const points: number[] = [];
  let at = 0;
  for (let i = 0; i < count - 1; i++) {
    at += Math.ceil((total - at) / (count - i));
    points.push(at);
  }
  return points;
}

/** The parts, joined in order into one new buffer. */
export function joinParts(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The channels averaged into one. */
export function toMono(planes: readonly Float32Array[]): Float32Array {
  const first = planes[0];
  if (!first) return new Float32Array(0);
  if (planes.length === 1) return first;
  const out = new Float32Array(first.length);
  for (const plane of planes) {
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + (plane[i] ?? 0) / planes.length;
  }
  return out;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * The sound at another sample rate, with a Hann-windowed sinc filter 16 zero crossings wide whose
 * cut-off is the lower of the two Nyquist frequencies, so nothing above 8 kHz folds back into the
 * speech. Each output sample's weights are normalised to sum to one. The filter is worked out once
 * per phase: a pair of common rates repeats after few output samples.
 */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input.slice();
  const length = Math.floor((input.length * to) / from);
  const out = new Float32Array(length);
  const cutoff = Math.min(1, to / from);
  const half = Math.ceil(16 / cutoff);
  const divisor = gcd(from, to);
  const step = from / divisor; // input samples per `phases` outputs, as a whole number
  const phases = to / divisor;
  const kernels: Float32Array[] = [];
  const kernel = (fraction: number) => {
    const weights = new Float32Array(2 * half);
    let sum = 0;
    for (let j = 0; j < 2 * half; j++) {
      const x = fraction - (j - half + 1); // distance from the output point to input sample
      const u = x / half;
      const window = Math.abs(u) >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * u);
      const arg = Math.PI * cutoff * x;
      const sinc = arg === 0 ? 1 : Math.sin(arg) / arg;
      weights[j] = sinc * window;
      sum += weights[j] ?? 0;
    }
    for (let j = 0; j < weights.length; j++) weights[j] = (weights[j] ?? 0) / sum;
    return weights;
  };
  for (let i = 0; i < length; i++) {
    const phase = i % phases;
    const base = Math.floor(i / phases) * step + Math.floor((phase * step) / phases);
    const fraction = (phase * step) / phases - Math.floor((phase * step) / phases);
    const cached = phases <= 4096 ? kernels[phase] : null;
    const weights = cached ?? kernel(fraction);
    if (!cached && phases <= 4096) kernels[phase] = weights;
    let value = 0;
    const first = base - half + 1;
    for (let j = 0; j < weights.length; j++) {
      const k = first + j;
      const sample = k < 0 ? 0 : k >= input.length ? 0 : (input[k] ?? 0);
      value += sample * (weights[j] ?? 0);
    }
    out[i] = value;
  }
  return out;
}

export interface Window {
  start: number;
  end: number;
}

/**
 * The 30-second windows of `length` samples at 16 kHz, one after the other with no overlap. A last
 * window under a fifth of a second after a full one is dropped; a recording that short on its own
 * is kept.
 */
export function windows(length: number): Window[] {
  const out: Window[] = [];
  for (let start = 0; start < length; start += WINDOW_SAMPLES) {
    const end = Math.min(length, start + WINDOW_SAMPLES);
    if (start > 0 && end - start < MIN_TAIL_SAMPLES) break;
    out.push({ start, end });
  }
  return out;
}

/** True when no sample of the window reaches the silence level. */
export function isSilent(samples: Float32Array): boolean {
  for (const sample of samples) if (Math.abs(sample) >= SILENCE_PEAK) return false;
  return true;
}

export interface MelContext {
  cos: Float32Array;
  sin: Float32Array;
  hann: Float32Array;
  filters: Float32Array[];
}

const hzToMel = (hz: number) =>
  hz < 1000 ? (3 * hz) / 200 : 15 + Math.log(hz / 1000) / (Math.log(6.4) / 27);
const melToHz = (mel: number) =>
  mel < 15 ? (200 * mel) / 3 : 1000 * Math.exp((Math.log(6.4) / 27) * (mel - 15));

/**
 * Whisper's 80 mel filters over the 201 bins of a 400-point FFT at 16 kHz: the Slaney mel scale,
 * triangles normalised to equal area, as librosa.filters.mel(sr=16000, n_fft=400, n_mels=80) makes.
 */
export function melFilters(): Float32Array[] {
  const bins = MEL.fft / 2 + 1;
  const low = hzToMel(0);
  const high = hzToMel(SAMPLE_RATE / 2);
  const points = Array.from({ length: MEL.bins + 2 }, (_, i) =>
    melToHz(low + ((high - low) * i) / (MEL.bins + 1)),
  );
  return Array.from({ length: MEL.bins }, (_, m) => {
    const row = new Float32Array(bins);
    const left = points[m] ?? 0;
    const centre = points[m + 1] ?? 0;
    const right = points[m + 2] ?? 0;
    const area = 2 / (right - left);
    for (let k = 0; k < bins; k++) {
      const hz = (k * SAMPLE_RATE) / MEL.fft;
      const rise = (hz - left) / (centre - left);
      const fall = (right - hz) / (right - centre);
      row[k] = Math.max(0, Math.min(rise, fall)) * area;
    }
    return row;
  });
}

/** The tables logMel() uses, made once. */
export function melContext(): MelContext {
  const bins = MEL.fft / 2 + 1;
  const cos = new Float32Array(bins * MEL.fft);
  const sin = new Float32Array(bins * MEL.fft);
  for (let k = 0; k < bins; k++) {
    for (let n = 0; n < MEL.fft; n++) {
      const angle = (2 * Math.PI * ((k * n) % MEL.fft)) / MEL.fft;
      cos[k * MEL.fft + n] = Math.cos(angle);
      sin[k * MEL.fft + n] = Math.sin(angle);
    }
  }
  const hann = new Float32Array(MEL.fft);
  for (let n = 0; n < MEL.fft; n++) hann[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / MEL.fft);
  return { cos, sin, hann, filters: melFilters() };
}

/**
 * Whisper's input for one window, as its feature extractor makes it: the samples padded with zeros
 * to 30 seconds, a centred short-time Fourier transform (reflected at the edges, periodic Hann
 * window of 400, hop 160) without its last frame, the power through the mel filters, log10 with a
 * floor of 1e-10, clamped to 8 below the loudest value, then (x + 4) / 4. Shape [80, 3000].
 */
export function logMel(context: MelContext, samples: Float32Array): Float32Array {
  const { fft, hop, bins: melBins, frames } = MEL;
  const total = WINDOW_SAMPLES;
  const half = fft / 2;
  const padded = new Float32Array(total + fft);
  for (let i = 0; i < padded.length; i++) {
    let j = i - half;
    if (j < 0) j = -j;
    if (j >= total) j = 2 * (total - 1) - j;
    padded[i] = j < samples.length ? (samples[j] ?? 0) : 0;
  }
  const bins = fft / 2 + 1;
  const frame = new Float32Array(fft);
  const power = new Float32Array(bins);
  const out = new Float32Array(melBins * frames);
  let max = Number.NEGATIVE_INFINITY;
  for (let t = 0; t < frames; t++) {
    for (let n = 0; n < fft; n++) frame[n] = (padded[t * hop + n] ?? 0) * (context.hann[n] ?? 0);
    for (let k = 0; k < bins; k++) {
      let re = 0;
      let im = 0;
      const row = k * fft;
      for (let n = 0; n < fft; n++) {
        const value = frame[n] ?? 0;
        re += value * (context.cos[row + n] ?? 0);
        im += value * (context.sin[row + n] ?? 0);
      }
      power[k] = re * re + im * im;
    }
    for (let m = 0; m < melBins; m++) {
      const filter = context.filters[m];
      let sum = 0;
      if (filter) for (let k = 0; k < bins; k++) sum += (filter[k] ?? 0) * (power[k] ?? 0);
      const value = Math.log10(Math.max(sum, 1e-10));
      out[m * frames + t] = value;
      if (value > max) max = value;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i] ?? 0, max - 8) + 4) / 4;
  return out;
}

/**
 * The next token, greedily: the most likely text token or the end of text, from the logits of the
 * last position (`offset` is where its row starts). Timestamps, language and task tokens are never
 * chosen.
 */
export function pickToken(logits: Float32Array, offset: number): number {
  let best: number = TOKENS.endOfText;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (let token = 0; token <= TOKENS.endOfText; token++) {
    const value = logits[offset + token] ?? Number.NEGATIVE_INFINITY;
    if (value > bestValue) {
      bestValue = value;
      best = token;
    }
  }
  return best;
}

/** GPT-2's map from the characters of its byte-level vocabulary back to the bytes they stand for. */
export function byteDecoder(): Map<string, number> {
  const printable: number[] = [];
  for (let b = 33; b <= 126; b++) printable.push(b);
  for (let b = 161; b <= 172; b++) printable.push(b);
  for (let b = 174; b <= 255; b++) printable.push(b);
  const map = new Map<string, number>();
  for (const b of printable) map.set(String.fromCharCode(b), b);
  let extra = 0;
  for (let b = 0; b < 256; b++) {
    if (!printable.includes(b)) map.set(String.fromCharCode(256 + extra++), b);
  }
  return map;
}

/** The vocabulary (token text to id, as vocab.json holds it) turned into a table by id. */
export function tokenTable(vocab: Record<string, number>): string[] {
  const table: string[] = [];
  for (const [text, id] of Object.entries(vocab)) table[id] = text;
  return table;
}

/** UTF-8 bytes as text; a broken sequence becomes U+FFFD. */
export function utf8(bytes: readonly number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i] ?? 0;
    const need = b < 0x80 ? 0 : b >= 0xf0 && b < 0xf8 ? 3 : b >= 0xe0 ? 2 : b >= 0xc0 ? 1 : -1;
    if (need < 0) {
      out += "�";
      i++;
      continue;
    }
    let code = need === 0 ? b : b & (0x3f >> need);
    let ok = true;
    for (let j = 1; j <= need; j++) {
      const next = i + j < bytes.length ? (bytes[i + j] ?? 0) : -1;
      if (next < 0 || (next & 0xc0) !== 0x80) {
        ok = false;
        break;
      }
      code = (code << 6) | (next & 0x3f);
    }
    if (!ok) {
      out += "�";
      i++;
      continue;
    }
    out += String.fromCodePoint(code);
    i += need + 1;
  }
  return out;
}

/** Text tokens back into text. Special tokens (the end of text and above) are left out. */
export function decodeTokens(
  ids: readonly number[],
  table: readonly string[],
  bytes: Map<string, number>,
): string {
  const out: number[] = [];
  for (const id of ids) {
    if (id >= TOKENS.endOfText) continue;
    for (const char of table[id] ?? "") {
      const byte = bytes.get(char) ?? -1;
      if (byte >= 0) out.push(byte);
    }
  }
  return utf8(out);
}

/** The windows' texts as one, with a space at each join. */
export function joinTexts(texts: readonly string[]): string {
  return texts
    .map((text) => text.trim())
    .filter((text) => text !== "")
    .join(" ");
}

/** True when the error is the browser or the engine running out of memory. */
export function isOutOfMemory(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /out of memory|memory access out of bounds|cannot allocate|failed to allocate|allocation fail|could not allocate|Array buffer allocation|OOM|bad_alloc/i.test(
    text,
  );
}

export function outputName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "recording";
  return safeFilename(`${base}-transcript.txt`);
}

/** Seconds as m:ss. */
export function formatSeconds(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}
