import { type AbortSignalLike, defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import * as ort from "onnxruntime-web/wasm";
import {
  applyMask,
  DOWNLOAD_BYTES,
  type Job,
  type JobResult,
  MESSAGES,
  MODEL_SIZE,
  maskToRgba,
  STAGES,
  toTensor,
  withinPixelLimit,
} from "./logic";
import modelUrl from "./model/u2netp.onnx?url";

// The Web Worker of "Background Remover" (ADR 0051, ADR 0057). On the first job it downloads the
// U²-Netp model and ONNX Runtime's WebAssembly from this site, with progress, and keeps the session
// for every later job. The photo never leaves the device: it is decoded here, a 320 by 320 copy
// goes through the model, and the mask it gives becomes the alpha channel of the full-size photo.
//
// ONNX Runtime runs on one thread: more threads need SharedArrayBuffer, which needs cross-origin
// isolation headers the site does not send (ADR 0057). The WebAssembly is handed over as bytes, so
// the runtime fetches nothing by itself and never reaches for a CDN.

type Report = (stage: string, done: number, total: number) => void;

let session: Promise<ort.InferenceSession> | undefined;

/** A same-origin file as bytes, reporting each chunk. */
async function download(url: string, signal: AbortSignalLike, onBytes: (n: number) => void) {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (caught) {
    throw new ToolError(MESSAGES.download, { cause: caught });
  }
  if (!response.ok || !response.body) throw new ToolError(MESSAGES.download);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (signal.aborted) {
      await reader.cancel();
      signal.throwIfAborted();
    }
    chunks.push(value);
    length += value.byteLength;
    onBytes(value.byteLength);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function createSession(signal: AbortSignalLike, report: Report) {
  const total = DOWNLOAD_BYTES.model + DOWNLOAD_BYTES.runtime;
  let done = 0;
  const onBytes = (n: number) => {
    done += n;
    report(STAGES.download, Math.min(done, total), total);
  };
  report(STAGES.download, 0, total);
  const [wasm, model] = await Promise.all([
    download(wasmUrl, signal, onBytes),
    download(modelUrl, signal, onBytes),
  ]);
  signal.throwIfAborted();
  report(STAGES.start, 0, 1);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmBinary = wasm.buffer;
  try {
    return await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
  } catch (caught) {
    throw new ToolError(MESSAGES.failed, { cause: caught });
  }
}

function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new ToolError(MESSAGES.failed);
  return context;
}

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  const report: Report = (stage, done, total) => progress({ done, total, stage });

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(job.file);
  } catch {
    throw new ToolError(MESSAGES.unreadable);
  }
  try {
    const { width, height } = bitmap;
    if (!withinPixelLimit(width, height)) throw new ToolError(MESSAGES.tooManyPixels);

    if (!session) {
      session = createSession(signal, report);
      // A failed or cancelled start is not kept: the next job tries again.
      session.catch(() => {
        session = undefined;
      });
    }
    const model = await session;
    signal.throwIfAborted();

    report(STAGES.remove, 0, 1);
    const small = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE);
    const smallContext = context2d(small);
    smallContext.drawImage(bitmap, 0, 0, MODEL_SIZE, MODEL_SIZE);
    const pixels = smallContext.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
    const input = new ort.Tensor("float32", toTensor(pixels), [1, 3, MODEL_SIZE, MODEL_SIZE]);
    const inputName = model.inputNames[0];
    const outputName = model.outputNames[0];
    if (!inputName || !outputName) throw new ToolError(MESSAGES.failed);
    const outputs = await model.run({ [inputName]: input });
    const prediction = outputs[outputName]?.data;
    if (!(prediction instanceof Float32Array)) throw new ToolError(MESSAGES.failed);
    signal.throwIfAborted();

    report(STAGES.save, 0, 1);
    smallContext.putImageData(new ImageData(maskToRgba(prediction), MODEL_SIZE), 0, 0);
    const full = new OffscreenCanvas(width, height);
    const fullContext = context2d(full);
    fullContext.imageSmoothingEnabled = true;
    fullContext.imageSmoothingQuality = "high";
    fullContext.drawImage(small, 0, 0, width, height);
    const mask = fullContext.getImageData(0, 0, width, height).data;
    fullContext.clearRect(0, 0, width, height);
    fullContext.drawImage(bitmap, 0, 0);
    const photo = fullContext.getImageData(0, 0, width, height);
    applyMask(photo.data, mask);
    fullContext.putImageData(photo, 0, 0);

    let blob: Blob;
    try {
      blob = await full.convertToBlob({ type: "image/png" });
    } catch {
      throw new ToolError(MESSAGES.failed);
    }
    signal.throwIfAborted();
    report(STAGES.save, 1, 1);
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
});
