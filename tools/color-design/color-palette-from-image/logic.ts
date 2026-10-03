// Pure logic of "Color Palette from Image": the file rules and the median cut that finds the
// dominant colours in a list of pixels, with no DOM, no network and no top-level statements
// (docs/tool-contract.md). ui.tsx draws the picture small on a canvas and passes its pixels here.

export const LIMITS = {
  maxInputBytes: 25 * 1024 * 1024,
  maxFiles: 1,
  minColors: 1,
  maxColors: 8,
} as const;

/** The largest picture read: 50 megapixels, under 200 MB of memory decoded. */
export const MAX_PIXELS = 50_000_000;

/**
 * The longest side the picture is shrunk to before counting: our own choice. 200 pixels keep
 * 40,000 samples at most, enough for the main colours and quick on a phone.
 */
export const SAMPLE_SIDE = 200;

/** Pixels more transparent than this (out of 255) are left out. */
export const MIN_ALPHA = 128;

export const INPUT_TYPES = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
} as const;

export type ImageType = keyof typeof INPUT_TYPES;

export interface Input {
  /** RGBA bytes, four per pixel, as a canvas gives them. */
  pixels: Uint8ClampedArray | Uint8Array;
  count: number;
}

export interface Swatch {
  hex: string;
  /** The share of the counted pixels in this colour's group, in percent, one decimal. */
  share: number;
}

export type Result = { ok: true; colors: Swatch[] } | { ok: false; error: string };

export const MESSAGES = {
  notAnImage: "This file is not a JPG, PNG or WebP image.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  unreadable: "This image could not be read. It may be damaged.",
  tooManyPixels: "This image has more than 50 megapixels, more than the browser can hold.",
  transparent: "This image has no visible pixels to take colours from.",
  count: "Choose from 1 to 8 colours.",
} as const;

export function imageTypeOf(file: { name: string; type: string }): ImageType | undefined {
  if (file.type in INPUT_TYPES) return file.type as ImageType;
  if (file.type !== "") return;
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return;
}

export function checkFile(file: { name: string; type: string; size: number }): string | null {
  if (!imageTypeOf(file)) return MESSAGES.notAnImage;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return null;
}

export function withinPixelLimit(width: number, height: number): boolean {
  return width > 0 && height > 0 && width * height <= MAX_PIXELS;
}

/** The size a picture is drawn at for sampling: its longest side at most SAMPLE_SIDE. */
export function sampleSize(width: number, height: number) {
  const scale = Math.min(1, SAMPLE_SIDE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

type Pixel = [number, number, number];

function channelRange(box: Pixel[], channel: 0 | 1 | 2): number {
  let min = 255;
  let max = 0;
  for (const pixel of box) {
    const value = pixel[channel];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min;
}

function widest(box: Pixel[]): { channel: 0 | 1 | 2; range: number } {
  let best: { channel: 0 | 1 | 2; range: number } = { channel: 0, range: -1 };
  for (const channel of [0, 1, 2] as const) {
    const range = channelRange(box, channel);
    if (range > best.range) best = { channel, range };
  }
  return best;
}

/**
 * Where a sorted box is split: at its median, moved to the nearest edge of the run of equal values
 * there, so one colour is never cut in two.
 */
function splitAt(box: Pixel[], channel: 0 | 1 | 2): number {
  const middle = Math.floor(box.length / 2);
  const value = box[middle]?.[channel];
  let low = middle;
  while (low > 0 && box[low - 1]?.[channel] === value) low--;
  let high = middle;
  while (high < box.length && box[high]?.[channel] === value) high++;
  if (low === 0) return high;
  if (high === box.length) return low;
  return middle - low <= high - middle ? low : high;
}

function toHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0");
}

/**
 * Median cut: all the pixels start in one box. The box with the most pixels times its widest
 * colour range is sorted along that channel and split at its median, until there are `count` boxes
 * or no box can be split. Each box gives its average colour, largest box first.
 */
export function run(input: Input): Result {
  const { count, pixels } = input;
  if (!Number.isInteger(count) || count < LIMITS.minColors || count > LIMITS.maxColors) {
    return { ok: false, error: MESSAGES.count };
  }
  const all: Pixel[] = [];
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if ((pixels[i + 3] ?? 0) < MIN_ALPHA) continue;
    all.push([pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0]);
  }
  if (all.length === 0) return { ok: false, error: MESSAGES.transparent };

  const boxes: Pixel[][] = [all];
  while (boxes.length < count) {
    let pick = -1;
    let score = 0;
    for (const [index, box] of boxes.entries()) {
      const value = box.length > 1 ? widest(box).range * box.length : 0;
      if (value > score) {
        score = value;
        pick = index;
      }
    }
    if (pick < 0) break;
    const box = boxes[pick] ?? [];
    const { channel } = widest(box);
    box.sort((a, b) => a[channel] - b[channel]);
    const middle = splitAt(box, channel);
    boxes.splice(pick, 1, box.slice(0, middle), box.slice(middle));
  }

  const colors = boxes
    .map((box) => {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (const pixel of box) {
        red += pixel[0];
        green += pixel[1];
        blue += pixel[2];
      }
      const hex = `#${[red, green, blue].map((total) => toHex(total / box.length)).join("")}`;
      return { hex, size: box.length };
    })
    .sort((a, b) => b.size - a.size);

  // Two boxes can average to the same colour; they are merged so no swatch repeats.
  const merged = new Map<string, number>();
  for (const color of colors) merged.set(color.hex, (merged.get(color.hex) ?? 0) + color.size);
  return {
    ok: true,
    colors: [...merged].map(([hex, size]) => ({
      hex,
      share: Math.round((size / all.length) * 1000) / 10,
    })),
  };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
