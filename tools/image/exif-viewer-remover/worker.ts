import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  type Block,
  describe,
  type Job,
  type JobResult,
  jpegBlocks,
  MESSAGES,
  pngBlocks,
  sniff,
  stripJpeg,
  webpBlocks,
} from "./logic";

// The Web Worker of "EXIF Viewer & Remover" (ADR 0051, ADR 0069). exifr's lite build reads the
// EXIF and GPS tags of a JPEG; it is imported on the first job, so no other page loads it. A JPEG
// is then rewritten without its metadata blocks by stripJpeg, which copies the picture data byte
// for byte. A PNG or WebP is only described here: the page redraws it through a canvas.

type Exifr = { parse(input: Uint8Array, options: object): Promise<Record<string, unknown>> };

let loading: Promise<Exifr> | undefined;
const loadExifr = () =>
  // @ts-expect-error: exifr ships type declarations for its main entry only, not the lite build.
  (loading ??= import("exifr/dist/lite.esm.mjs").then((module) => module.default as Exifr));

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  progress({ done: 0, total: 2, stage: "Reading" });
  const bytes = new Uint8Array(await job.file.arrayBuffer());
  const format = sniff(bytes);
  if (!format) throw new ToolError(MESSAGES.type);
  signal.throwIfAborted();

  if (format !== "jpeg") {
    let blocks: Block[];
    try {
      blocks = format === "png" ? pngBlocks(bytes) : webpBlocks(bytes);
    } catch {
      throw new ToolError(MESSAGES.unreadable);
    }
    progress({ done: 2, total: 2, stage: "Done" });
    return { format, rows: [], location: null, orientation: null, blocks, cleaned: null };
  }

  let blocks: Block[];
  try {
    blocks = jpegBlocks(bytes);
  } catch {
    throw new ToolError(MESSAGES.unreadable);
  }
  let tags: Record<string, unknown> = {};
  if (blocks.includes("EXIF")) {
    const exifr = await loadExifr();
    try {
      tags =
        (await exifr.parse(bytes, {
          tiff: true,
          exif: true,
          gps: true,
          xmp: false,
          translateKeys: true,
          translateValues: false,
          reviveValues: false,
          mergeOutput: true,
        })) ?? {};
    } catch {
      // Damaged EXIF: the blocks are still listed and still removed.
      tags = {};
    }
  }
  signal.throwIfAborted();
  progress({ done: 1, total: 2, stage: "Removing" });
  const { rows, location, orientation } = describe(tags);
  let cleaned: Uint8Array;
  try {
    cleaned = stripJpeg(bytes, orientation);
  } catch {
    throw new ToolError(MESSAGES.unreadable);
  }
  progress({ done: 2, total: 2, stage: "Done" });
  return {
    format,
    rows,
    location,
    orientation,
    blocks,
    cleaned: new Blob([cleaned as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }),
  };
});
