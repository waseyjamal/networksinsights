import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from "mediabunny";
import * as ort from "onnxruntime-web/wasm";
import {
  byteDecoder,
  checkDuration,
  DECODER_SHAPE,
  decodeTokens,
  ENGINE,
  isOutOfMemory,
  isSilent,
  type Job,
  type JobResult,
  joinParts,
  joinTexts,
  logMel,
  MAX_TOKENS,
  MEL,
  MESSAGES,
  MODEL,
  type ModelFile,
  matches,
  melContext,
  modelBytes,
  PROMPT,
  pickToken,
  resample,
  SAMPLE_RATE,
  TOKENS,
  toHex,
  tokenTable,
  toMono,
  windows,
} from "./logic";

// The Web Worker of "Speech to Text" (ADR 0057, ADR 0066, ADR 0068). A transcription job first makes
// sure the model is here: the encoder, the decoder's two parts and the vocabulary come from /models/,
// each checked against its SHA-256, then the parts are joined and the whole decoder is checked too.
// Nothing is kept unless every check passes. Mediabunny reads the recording (WebCodecs decodes it,
// raw PCM needs none); logic.ts makes it 16 kHz mono and cuts it into 30-second windows, and each
// window goes through Whisper's encoder and then its decoder, one token at a time. One thread: the
// site is not cross-origin isolated.

interface Model {
  encoder: ort.InferenceSession;
  decoder: ort.InferenceSession;
  table: string[];
}

let model: Model | undefined;

type Signal = { aborted: boolean; throwIfAborted(): void };
type Progress = (progress: { done: number; total: number; stage?: string }) => void;

/** One file, read with progress, then checked; any mismatch refuses the whole download. */
async function fetchChecked(
  file: ModelFile,
  signal: AbortSignal,
  onBytes: (count: number) => void,
): Promise<Uint8Array> {
  const response = await fetch(file.url, { signal });
  if (!response.ok || !response.body) throw new ToolError(MESSAGES.modelFailed);
  const reader = response.body.getReader();
  const bytes = new Uint8Array(file.bytes);
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > bytes.length) throw new ToolError(MESSAGES.modelFailed);
    bytes.set(value, at);
    at += value.length;
    onBytes(value.length);
  }
  const hex = toHex(await crypto.subtle.digest("SHA-256", bytes));
  if (!matches(file, at, hex)) throw new ToolError(MESSAGES.modelFailed);
  return bytes;
}

async function load(signal: AbortSignal, progress: Progress): Promise<Model> {
  if (model) return model;
  const origin = self.location.origin;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = {
    mjs: `${origin}${ENGINE.base}${ENGINE.mjs}`,
    wasm: `${origin}${ENGINE.base}${ENGINE.wasm}`,
  };
  const total = modelBytes();
  let received = 0;
  const onBytes = (count: number) => {
    received += count;
    progress({ done: received, total, stage: "Downloading the model" });
  };
  progress({ done: 0, total, stage: "Downloading the model" });
  const encoderBytes = await fetchChecked(MODEL.encoder, signal, onBytes);
  const parts: Uint8Array[] = [];
  for (const part of MODEL.decoderParts) parts.push(await fetchChecked(part, signal, onBytes));
  const vocabBytes = await fetchChecked(MODEL.vocab, signal, onBytes);
  const decoderBytes = joinParts(parts);
  parts.length = 0;
  const joined = toHex(await crypto.subtle.digest("SHA-256", decoderBytes));
  if (!matches(MODEL.decoder, decoderBytes.length, joined))
    throw new ToolError(MESSAGES.modelFailed);
  signal.throwIfAborted();

  progress({ done: total, total, stage: "Starting the model" });
  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  };
  const encoder = await ort.InferenceSession.create(encoderBytes, options);
  const decoder = await ort.InferenceSession.create(decoderBytes, options);
  const vocab = JSON.parse(new TextDecoder().decode(vocabBytes)) as Record<string, number>;
  model = { encoder, decoder, table: tokenTable(vocab) };
  return model;
}

const open = (file: Blob) => new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

async function probe(file: Blob): Promise<number> {
  const input = open(file);
  try {
    if (!(await input.canRead())) throw new ToolError(MESSAGES.notAudio);
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new ToolError(MESSAGES.noAudio);
    const seconds = await input.computeDuration();
    const refused = checkDuration(seconds);
    if (refused) throw new ToolError(refused);
    if (!(await track.canDecode())) throw new ToolError(MESSAGES.cannotDecode);
    return seconds;
  } catch (caught) {
    if (caught instanceof ToolError) throw caught;
    throw new ToolError(MESSAGES.unreadable);
  } finally {
    input.dispose();
  }
}

/** The whole recording as 16 kHz mono. */
async function decode(file: Blob, signal: Signal): Promise<Float32Array> {
  const input = open(file);
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new ToolError(MESSAGES.noAudio);
    const channels = track.numberOfChannels;
    const pieces: Float32Array[][] = Array.from({ length: channels }, () => []);
    let frames = 0;
    for await (const sample of new AudioSampleSink(track).samples(0)) {
      try {
        signal.throwIfAborted();
        for (let plane = 0; plane < channels; plane++) {
          const options = { planeIndex: plane, format: "f32-planar" } as const;
          const data = new Float32Array(sample.allocationSize(options) / 4);
          sample.copyTo(data, options);
          pieces[plane]?.push(data);
          if (plane === 0) frames += data.length;
        }
      } finally {
        sample.close();
      }
    }
    const planes = pieces.map((list) => {
      const out = new Float32Array(frames);
      let at = 0;
      for (const piece of list) {
        out.set(piece.subarray(0, frames - at), at);
        at += piece.length;
      }
      return out;
    });
    return resample(toMono(planes), track.sampleRate, SAMPLE_RATE);
  } finally {
    input.dispose();
  }
}

/** One window through the encoder, then the decoder greedily, with its key-value cache. */
async function transcribeWindow(loaded: Model, features: Float32Array, signal: Signal) {
  const { encoder, decoder } = loaded;
  const encoded = await encoder.run({
    input_features: new ort.Tensor("float32", features, [1, MEL.bins, MEL.frames]),
  });
  const { last_hidden_state: hidden } = encoded;
  if (!hidden) throw new ToolError(MESSAGES.failed);
  signal.throwIfAborted();

  const empty = () =>
    new ort.Tensor("float32", new Float32Array(0), [
      1,
      DECODER_SHAPE.heads,
      0,
      DECODER_SHAPE.headSize,
    ]);
  let past: Record<string, ort.Tensor> = {};
  for (const name of decoder.inputNames)
    if (name.startsWith("past_key_values")) past[name] = empty();
  const tokens: number[] = [...PROMPT];
  try {
    for (let step = 0; step < MAX_TOKENS; step++) {
      signal.throwIfAborted();
      const first = step === 0;
      const ids = first ? tokens : tokens.slice(-1);
      const output = await decoder.run({
        input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
        encoder_hidden_states: hidden,
        use_cache_branch: new ort.Tensor("bool", [!first], [1]),
        ...past,
      });
      const { logits } = output;
      if (!logits) throw new ToolError(MESSAGES.failed);
      const vocabulary = logits.dims[2] ?? 0;
      const next = pickToken(logits.data as Float32Array, ((logits.dims[1] ?? 1) - 1) * vocabulary);
      logits.dispose();
      const kept: Record<string, ort.Tensor> = {};
      for (const name of decoder.outputNames) {
        if (!name.startsWith("present")) continue;
        const key = name.replace("present", "past_key_values");
        const tensor = output[name];
        if (!tensor) continue;
        // After the first step the decoder hands back an empty cross-attention cache: keep the old.
        const old = past[key];
        if (!first && name.includes(".encoder.") && old) {
          tensor.dispose();
          kept[key] = old;
        } else {
          old?.dispose();
          kept[key] = tensor;
        }
      }
      past = kept;
      if (next === TOKENS.endOfText) break;
      tokens.push(next);
    }
  } finally {
    for (const tensor of Object.values(past)) tensor.dispose();
    hidden.dispose();
  }
  return tokens.slice(PROMPT.length);
}

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  if (job.kind === "status") return { kind: "status", loaded: model !== undefined };
  if (job.kind === "probe")
    return { kind: "probe", probe: { durationSeconds: await probe(job.file) } };

  try {
    const seconds = await probe(job.file);
    const loaded = await load(signal as unknown as AbortSignal, progress);
    signal.throwIfAborted();

    progress({ done: 0, total: 1, stage: "Decoding the recording" });
    let samples: Float32Array;
    try {
      samples = await decode(job.file, signal);
    } catch (caught) {
      if (caught instanceof ToolError || signal.aborted) throw caught;
      if (isOutOfMemory(caught)) throw new ToolError(MESSAGES.outOfMemory);
      throw new ToolError(MESSAGES.cannotDecode);
    }
    const parts = windows(samples.length);
    const context = melContext();
    const bytes = byteDecoder();
    const texts: string[] = [];
    for (const [index, part] of parts.entries()) {
      signal.throwIfAborted();
      progress({
        done: index,
        total: parts.length,
        stage: `Transcribing part ${index + 1} of ${parts.length}`,
      });
      const slice = samples.subarray(part.start, part.end);
      if (isSilent(slice)) continue;
      const tokens = await transcribeWindow(loaded, logMel(context, slice), signal);
      texts.push(decodeTokens(tokens, loaded.table, bytes));
    }
    const text = joinTexts(texts);
    if (text === "") throw new ToolError(MESSAGES.silent);
    progress({ done: parts.length, total: parts.length, stage: "Done" });
    return { kind: "transcribe", text, windows: parts.length, durationSeconds: seconds };
  } catch (caught) {
    if (caught instanceof ToolError || signal.aborted) throw caught;
    if (isOutOfMemory(caught)) throw new ToolError(MESSAGES.outOfMemory);
    if (model === undefined) throw new ToolError(MESSAGES.modelFailed);
    throw new ToolError(MESSAGES.failed);
  }
});
