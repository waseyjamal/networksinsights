import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import * as ort from "onnxruntime-web/wasm";
import {
  applyAlpha,
  checkPixels,
  ENGINE,
  isOutOfMemory,
  type Job,
  type JobResult,
  MESSAGES,
  MODEL,
  modelSize,
  modelTensor,
  scaleMatte,
  toHex,
} from "./logic";

// The Web Worker of "Background Remover" (ADR 0057, ADR 0066). On the first job it loads ONNX
// Runtime Web's plain WebAssembly backend from /vendor/onnxruntime-web/ and the MODNet portrait
// model from /models/, checks the model's SHA-256, and keeps both for the next job. The model sees
// the picture with its shorter side at 512 pixels and gives a matte, which is scaled back to the
// picture's own size and becomes its alpha. One thread: the site is not cross-origin isolated.

let session: Promise<ort.InferenceSession> | undefined;

function load(): Promise<ort.InferenceSession> {
  session ??= (async () => {
    const origin = self.location.origin;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = {
      mjs: `${origin}${ENGINE.base}${ENGINE.mjs}`,
      wasm: `${origin}${ENGINE.base}${ENGINE.wasm}`,
    };
    const response = await fetch(MODEL.url);
    if (!response.ok) throw new ToolError(MESSAGES.modelFailed);
    const bytes = await response.arrayBuffer();
    if (toHex(await crypto.subtle.digest("SHA-256", bytes)) !== MODEL.sha256) {
      throw new ToolError(MESSAGES.modelFailed);
    }
    return ort.InferenceSession.create(new Uint8Array(bytes), {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  })().catch((caught) => {
    session = undefined;
    if (caught instanceof ToolError) throw caught;
    if (isOutOfMemory(caught)) throw new ToolError(MESSAGES.outOfMemory);
    throw new ToolError(MESSAGES.modelFailed);
  });
  return session;
}

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  progress({ done: 0, total: 4, stage: "Reading" });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(job.file, {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
  } catch {
    throw new ToolError(MESSAGES.unreadable);
  }
  const { width, height } = bitmap;
  const refused = checkPixels(width, height);
  if (refused) {
    bitmap.close();
    throw new ToolError(refused);
  }

  try {
    const picture = new OffscreenCanvas(width, height);
    const context = picture.getContext("2d", { willReadFrequently: true });
    if (!context) throw new ToolError(MESSAGES.outOfMemory);
    context.drawImage(bitmap, 0, 0);
    const size = modelSize(width, height);
    const small = new OffscreenCanvas(size.width, size.height);
    const smallContext = small.getContext("2d");
    if (!smallContext) throw new ToolError(MESSAGES.outOfMemory);
    smallContext.imageSmoothingQuality = "high";
    smallContext.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const pixels = smallContext.getImageData(0, 0, size.width, size.height).data;
    signal.throwIfAborted();

    progress({ done: 1, total: 4, stage: "Loading the model" });
    const model = await load();
    signal.throwIfAborted();

    progress({ done: 2, total: 4, stage: "Finding the person" });
    const input = new ort.Tensor("float32", modelTensor(pixels, size.width, size.height), [
      1,
      3,
      size.height,
      size.width,
    ]);
    const { output } = await model.run({ input });
    input.dispose();
    if (!output) throw new ToolError(MESSAGES.failed);
    const alpha = scaleMatte(output.data as Float32Array, size.width, size.height, width, height);
    output.dispose();
    signal.throwIfAborted();

    progress({ done: 3, total: 4, stage: "Writing" });
    const image = context.getImageData(0, 0, width, height);
    applyAlpha(image.data, alpha);
    context.clearRect(0, 0, width, height);
    context.putImageData(image, 0, 0);
    const blob = await picture.convertToBlob({ type: "image/png" });
    progress({ done: 4, total: 4, stage: "Done" });
    return { blob, width, height };
  } catch (caught) {
    bitmap.close();
    if (caught instanceof ToolError || signal.aborted) throw caught;
    if (isOutOfMemory(caught)) throw new ToolError(MESSAGES.outOfMemory);
    throw new ToolError(MESSAGES.failed);
  }
});
