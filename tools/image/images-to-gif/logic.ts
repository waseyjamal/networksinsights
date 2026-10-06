// Pure logic of "Images to GIF": the file rules, the limits, the settings, the size of the GIF, the
// order of the pictures and where each one sits in a frame, with no DOM, no network and no
// top-level statements (docs/tool-contract.md). worker.ts draws each picture with an
// OffscreenCanvas and writes the GIF with gifenc (ADR 0061).

/** The limits the manifest declares and the page enforces. Our own choices. */
export const LIMITS = {
  /** 25 MB per picture. */
  maxInputBytes: 25 * 1024 * 1024,
  /** 100 pictures, one frame each: the GIF is built in memory. */
  maxFiles: 100,
  minFiles: 2,
} as const;

export const RANGES = {
  /** The GIF's width in pixels; its height follows the first picture, at most 800 pixels too. */
  width: { min: 50, max: 800 },
  /** Time each frame shows, in milliseconds. GIF stores hundredths of a second. */
  delay: { min: 20, max: 10_000 },
} as const;

export const DEFAULTS = { width: 480, delay: 500 } as const;

/** Forever writes the looping extension; once writes none, so the GIF plays one time and stops. */
export const LOOPS = {
  forever: "Loop forever",
  once: "Play once",
} as const;

export type Loop = keyof typeof LOOPS;

export const INPUT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** How many pixels of a frame its palette is chosen from: sampling keeps a frame quick. */
export const PALETTE_SAMPLE_PIXELS = 16_384;

/** Kept for the manifest's input schema: the choices a visitor makes. */
export interface Input {
  width: number;
  delay: number;
  loop: Loop;
}

export interface Job {
  images: Blob[];
  width: number;
  height: number;
  delay: number;
  loop: Loop;
}

export interface JobResult {
  blob: Blob;
  frames: number;
}

export const MESSAGES = {
  notAnImage: "This file is not a JPG, PNG or WebP image.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooMany: `Up to ${LIMITS.maxFiles} pictures can go in one GIF.`,
  tooFew: `Add at least ${LIMITS.minFiles} pictures to make an animation.`,
  range: (label: string, min: number, max: number, unit: string) =>
    `${label} must be from ${min} to ${max} ${unit}.`,
  unreadable: (name: string) => `${name} could not be read. It may be damaged.`,
  noCanvas:
    "Your browser cannot draw pictures in a background worker, so it cannot make a GIF here. A recent Chrome, Edge, Firefox or Safari can.",
  failed: "The GIF could not be made.",
} as const;

export function isImage(file: { name: string; type: string }): boolean {
  if ((INPUT_TYPES as readonly string[]).includes(file.type)) return true;
  return file.type === "" && /\.(jpe?g|png|webp)$/i.test(file.name);
}

export function checkFile(file: { name: string; type: string; size: number }): string | undefined {
  if (!isImage(file)) return MESSAGES.notAnImage;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return;
}

/** How many more pictures fit in the list. */
export function room(count: number): number {
  return Math.max(0, LIMITS.maxFiles - count);
}

/** Every problem with the settings and the list, by field. */
export function checkSettings(
  count: number,
  width: number,
  delay: number,
): Partial<Record<"count" | "width" | "delay", string>> {
  const errors: Partial<Record<"count" | "width" | "delay", string>> = {};
  if (count < LIMITS.minFiles) errors.count = MESSAGES.tooFew;
  const w = RANGES.width;
  if (!Number.isInteger(width) || width < w.min || width > w.max) {
    errors.width = MESSAGES.range("Width", w.min, w.max, "pixels");
  }
  const d = RANGES.delay;
  if (!Number.isInteger(delay) || delay < d.min || delay > d.max) {
    errors.delay = MESSAGES.range("Frame delay", d.min, d.max, "milliseconds");
  }
  return errors;
}

/**
 * The GIF's size: the width asked for, and the first picture's shape. A tall picture that would
 * make the GIF more than 800 pixels high gives 800 pixels high and a narrower width.
 */
export function gifSize(
  width: number,
  firstWidth: number,
  firstHeight: number,
): { width: number; height: number } {
  const height = Math.max(1, Math.round((width * firstHeight) / firstWidth));
  if (height <= RANGES.width.max) return { width, height };
  const max = RANGES.width.max;
  return { width: Math.max(1, Math.round((max * firstWidth) / firstHeight)), height: max };
}

/** Where a picture sits in a frame: as large as fits, kept in shape, in the middle. */
export function fit(
  width: number,
  height: number,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(frameWidth / width, frameHeight / height);
  const w = width * scale;
  const h = height * scale;
  return { x: (frameWidth - w) / 2, y: (frameHeight - h) / 2, width: w, height: h };
}

/** gifenc's repeat: 0 loops forever, -1 writes no loop at all, so the GIF plays once. */
export function repeatFor(loop: Loop): number {
  return loop === "forever" ? 0 : -1;
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
 * An even sample of a frame's RGBA pixels, at most `maxPixels` of them, to choose its palette
 * from. A frame with no more pixels than that is returned as it is.
 */
export function paletteSample(rgba: Uint8ClampedArray, maxPixels: number): Uint8ClampedArray {
  const pixels = Math.floor(rgba.length / 4);
  const step = Math.max(1, Math.ceil(pixels / maxPixels));
  if (step === 1) return rgba;
  const out = new Uint8ClampedArray(Math.ceil(pixels / step) * 4);
  for (let pixel = 0, at = 0; pixel < pixels; pixel += step, at += 4) {
    out.set(rgba.subarray(pixel * 4, pixel * 4 + 4), at);
  }
  return out;
}

/** The length of the animation, in seconds, as GIF stores it: delays in hundredths. */
export function playSeconds(frames: number, delay: number): number {
  return (frames * Math.round(delay / 10)) / 100;
}

/** `beach.jpg` first gives `beach-animation.gif`. */
export function outputName(firstName: string | undefined): string {
  const base = (firstName ?? "").replace(/\.[^.]+$/, "").trim() || "images";
  return `${base}-animation.gif`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
