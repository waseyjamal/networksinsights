import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import createLibheif from "libheif-js/libheif-wasm/libheif.js";
import {
  flattenOnWhite,
  type Job,
  type JobResult,
  LIBHEIF_ASSETS,
  MESSAGES,
  OUTPUT_FORMATS,
  QUALITIES,
  readHeifInfo,
  withinPixelLimit,
} from "./logic";

// The Web Worker of "HEIC to JPG" (ADR 0051, ADR 0060). The photo's boxes are read first, so a photo
// too large for memory is refused before anything is decoded. libheif (with libde265 for HEVC),
// compiled to WebAssembly, then decodes it with its rotation and mirroring applied; its .wasm file
// is fetched unmodified from this site on the first job. An OffscreenCanvas encodes the pixels, so
// the result holds only pixels: no EXIF, no location. If libheif cannot decode a photo, the
// browser's own decoder is tried: Safari 17 and later read HEIC natively.

interface HeifImage {
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  has_alpha_channel(): boolean;
  display(
    target: { data: Uint8ClampedArray; width: number; height: number },
    done: (result: unknown) => void,
  ): void;
  handle: number;
}

interface Libheif {
  HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[]; decoder: number | null };
  heif_image_handle_release(handle: number): void;
  heif_context_free(context: number): void;
}

let loading: Promise<Libheif> | undefined;

function libheif(): Promise<Libheif> {
  loading ??= new Promise<Libheif>((resolve, reject) => {
    // Emscripten fills in the object it is given and calls onRuntimeInitialized, which can happen
    // before the factory returns: resolve with that object, not with the return value.
    const options: { [key: string]: unknown; onRuntimeInitialized?: () => void } = {
      locateFile: (name: string) => new URL(`${LIBHEIF_ASSETS}${name}`, self.location.origin).href,
      onAbort: () => reject(new Error("libheif did not start")),
      print: () => {},
      printErr: () => {},
    };
    options.onRuntimeInitialized = () => resolve(options as unknown as Libheif);
    (createLibheif as unknown as (options: object) => unknown)(options);
  }).catch((caught) => {
    loading = undefined;
    throw caught;
  });
  return loading;
}

/** The pixels of the primary image, with libheif. Undefined when libheif cannot decode them. */
async function decodeWithLibheif(
  bytes: Uint8Array,
): Promise<{ pixels: ImageData; alpha: boolean } | undefined> {
  let heif: Libheif;
  try {
    heif = await libheif();
  } catch {
    return;
  }
  const decoder = new heif.HeifDecoder();
  // libheif logs its own failures with console.log; the visitor sees our message instead.
  const log = console.log;
  console.log = () => {};
  try {
    const images = decoder.decode(bytes);
    try {
      const image = images.find((candidate) => candidate.is_primary()) ?? images[0];
      if (!image) return;
      const width = image.get_width();
      const height = image.get_height();
      if (!withinPixelLimit(width, height))
        throw new ToolError(MESSAGES.tooManyPixels(width, height));
      const target = { data: new Uint8ClampedArray(width * height * 4), width, height };
      const shown = await new Promise<unknown>((resolve) => image.display(target, resolve));
      if (!shown) return;
      return {
        pixels: new ImageData(target.data, width, height),
        alpha: image.has_alpha_channel(),
      };
    } finally {
      for (const image of images) heif.heif_image_handle_release(image.handle);
    }
  } finally {
    console.log = log;
    if (decoder.decoder) heif.heif_context_free(decoder.decoder);
    decoder.decoder = null;
  }
}

/** The browser's own decoder: Safari 17 and later read HEIC. Undefined elsewhere. */
async function decodeWithBrowser(file: Blob): Promise<ImageBitmap | undefined> {
  try {
    return await createImageBitmap(file);
  } catch {
    return;
  }
}

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  const { mime } = OUTPUT_FORMATS[job.format];
  progress({ done: 0, total: 3, stage: "Reading" });
  const bytes = new Uint8Array(await job.file.arrayBuffer());
  const info = readHeifInfo(bytes);
  if (!info.ok && info.reason === "not-heif") throw new ToolError(MESSAGES.notHeic);
  if (info.ok && !withinPixelLimit(info.width, info.height)) {
    throw new ToolError(MESSAGES.tooManyPixels(info.width, info.height));
  }
  signal.throwIfAborted();

  progress({ done: 1, total: 3, stage: "Decoding" });
  const decoded = await decodeWithLibheif(bytes);
  const pixels = decoded?.pixels;
  const bitmap = decoded ? undefined : await decodeWithBrowser(job.file);
  if (!pixels && !bitmap) throw new ToolError(MESSAGES.unreadable);
  signal.throwIfAborted();

  progress({ done: 2, total: 3, stage: "Writing" });
  const width = pixels?.width ?? bitmap?.width ?? 0;
  const height = pixels?.height ?? bitmap?.height ?? 0;
  if (!withinPixelLimit(width, height)) {
    bitmap?.close();
    throw new ToolError(MESSAGES.tooManyPixels(width, height));
  }
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new ToolError(MESSAGES.failed);
  if (pixels) {
    if (job.format === "jpg" && decoded?.alpha) flattenOnWhite(pixels.data);
    context.putImageData(pixels, 0, 0);
  } else if (bitmap) {
    if (job.format === "jpg") {
      context.fillStyle = "white";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
  }

  let blob: Blob;
  try {
    blob = await canvas.convertToBlob(
      job.format === "jpg" ? { type: mime, quality: QUALITIES[job.quality].value } : { type: mime },
    );
  } catch {
    throw new ToolError(MESSAGES.failed);
  }
  if (blob.type !== mime) throw new ToolError(MESSAGES.failed);
  progress({ done: 3, total: 3, stage: "Done" });
  return { blob, width, height };
});
