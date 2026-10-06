import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import * as ort from "onnxruntime-web/wasm";
import {
  checkPixels,
  ENGINE,
  isOutOfMemory,
  type Job,
  type JobResult,
  MESSAGES,
  MODEL,
  planTiles,
  SCALE,
  scaleAlpha,
  tileTensor,
  toHex,
  writeTile,
} from "./logic";

// The Web Worker of "Image Upscaler" (ADR 0057, ADR 0066). On the first job it loads ONNX Runtime
// Web's plain WebAssembly backend from /vendor/onnxruntime-web/ and the Real-ESRGAN model from
// /models/, checks the model's SHA-256, and keeps both for the next job. The picture is cut into
// tiles with enough context around each that the stitched result has no seams; one tile at a time
// is in memory, so the cost is the result itself. One thread: the site is not cross-origin
// isolated, so there is no SharedArrayBuffer.

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

async function readPixels(file: Blob): Promise<ImageData> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
  } catch {
    throw new ToolError(MESSAGES.unreadable);
  }
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new ToolError(MESSAGES.failed);
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  progress({ done: 0, total: 1, stage: "Reading" });
  const source = await readPixels(job.file);
  const { width, height } = source;
  const refused = checkPixels(width, height, job.device);
  if (refused) throw new ToolError(refused);
  signal.throwIfAborted();

  const tiles = planTiles(width, height);
  const total = tiles.length + 2;
  progress({ done: 1, total, stage: "Loading the model" });
  const model = await load();
  signal.throwIfAborted();

  try {
    const result = new ImageData(width * SCALE, height * SCALE);
    for (const [index, tile] of tiles.entries()) {
      progress({ done: index + 1, total, stage: `Upscaling part ${index + 1} of ${tiles.length}` });
      const input = new ort.Tensor("float32", tileTensor(source.data, width, tile), [
        1,
        3,
        tile.inHeight,
        tile.inWidth,
      ]);
      const { output } = await model.run({ input });
      input.dispose();
      if (!output) throw new ToolError(MESSAGES.failed);
      writeTile(result.data, result.width, tile, output.data as Float32Array);
      output.dispose();
      signal.throwIfAborted();
    }
    scaleAlpha(source.data, width, height, result.data);

    progress({ done: tiles.length + 1, total, stage: "Writing" });
    const canvas = new OffscreenCanvas(result.width, result.height);
    const context = canvas.getContext("2d");
    if (!context) throw new ToolError(MESSAGES.outOfMemory);
    context.putImageData(result, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    progress({ done: total, total, stage: "Done" });
    return { blob, width: result.width, height: result.height };
  } catch (caught) {
    if (caught instanceof ToolError || signal.aborted) throw caught;
    if (isOutOfMemory(caught)) throw new ToolError(MESSAGES.outOfMemory);
    throw new ToolError(MESSAGES.failed);
  }
});
