// Pure logic of "Add Watermark to Image": the file rules, the settings and where each copy of the
// text goes, with no DOM, no network and no top-level statements (docs/tool-contract.md).
// worker.ts decodes the picture, draws the text on an OffscreenCanvas and saves it again.

export const LIMITS = {
  maxInputBytes: 25 * 1024 * 1024,
  maxFiles: 1,
  maxTextLength: 100,
} as const;

/** The largest picture read: 50 megapixels, under 200 MB of memory decoded. */
export const MAX_PIXELS = 50_000_000;

/** JPG and WebP are saved again at this quality: our own choice, high so little is lost. */
export const QUALITY = 0.92;

export const RANGES = {
  /** Text height as a percent of the picture's shorter side. */
  size: { min: 1, max: 50 },
  opacity: { min: 5, max: 100 },
  rotation: { min: -180, max: 180 },
} as const;

export const POSITIONS = {
  tile: "Tiled over the whole picture",
  center: "Centre",
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
} as const;

export type Position = keyof typeof POSITIONS;

export const INPUT_TYPES = {
  "image/jpeg": { label: "JPG", extension: "jpg" },
  "image/png": { label: "PNG", extension: "png" },
  "image/webp": { label: "WebP", extension: "webp" },
} as const;

export type ImageType = keyof typeof INPUT_TYPES;

export interface Settings {
  text: string;
  size: number;
  /** HEX colour, #rgb or #rrggbb. */
  color: string;
  opacity: number;
  position: Position;
  rotation: number;
}

export type Input = Settings;

export interface Job extends Settings {
  image: Blob;
  type: ImageType;
}

export interface JobResult {
  blob: Blob;
  /** The type really written: PNG when the browser cannot write the one asked for. */
  type: ImageType;
  width: number;
  height: number;
}

export const MESSAGES = {
  notAnImage: "This file is not a JPG, PNG or WebP image.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  unreadable: "This image could not be read. It may be damaged.",
  tooManyPixels: "This image has more than 50 megapixels, more than the browser can hold.",
  failed: "The watermark could not be added.",
  noText: "Type the watermark text.",
  longText: "The watermark text can have at most 100 characters.",
  color: "Use a HEX colour with 3 or 6 digits, such as #ffffff.",
  range: (label: string, min: number, max: number) => `${label} must be from ${min} to ${max}.`,
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

export function normalizeHex(text: string): string | null {
  const digits = text.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(digits)) return `#${digits}`;
  if (/^[0-9a-f]{3}$/.test(digits)) return `#${[...digits].map((d) => d + d).join("")}`;
  return null;
}

/** Every problem with the settings, by field; an empty object when they can be used. */
export function checkSettings(settings: Settings): Partial<Record<keyof Settings, string>> {
  const errors: Partial<Record<keyof Settings, string>> = {};
  const text = settings.text.trim();
  if (text === "") errors.text = MESSAGES.noText;
  else if ([...text].length > LIMITS.maxTextLength) errors.text = MESSAGES.longText;
  if (!normalizeHex(settings.color)) errors.color = MESSAGES.color;
  for (const [key, label] of [
    ["size", "Text size"],
    ["opacity", "Opacity"],
    ["rotation", "Rotation"],
  ] as const) {
    const { min, max } = RANGES[key];
    const value = settings[key];
    if (!Number.isFinite(value) || value < min || value > max) {
      errors[key] = MESSAGES.range(label, min, max);
    }
  }
  return errors;
}

/** The text height in pixels for a picture: a percent of its shorter side, at least 8 pixels. */
export function fontPixels(width: number, height: number, sizePercent: number): number {
  return Math.max(8, Math.round((Math.min(width, height) * sizePercent) / 100));
}

/**
 * The centre of each copy of the text, in pixels from the top left. A corner copy sits one margin
 * (half the text height) in from both edges; a tiled watermark repeats on a grid with every other
 * row shifted by half a step, from beyond the edges so a rotated tile still covers the corners.
 */
export function placements(
  width: number,
  height: number,
  textWidth: number,
  textHeight: number,
  position: Position,
): Array<{ x: number; y: number }> {
  const margin = textHeight / 2;
  const halfW = textWidth / 2;
  const halfH = textHeight / 2;
  switch (position) {
    case "center":
      return [{ x: width / 2, y: height / 2 }];
    case "top-left":
      return [{ x: margin + halfW, y: margin + halfH }];
    case "top-right":
      return [{ x: width - margin - halfW, y: margin + halfH }];
    case "bottom-left":
      return [{ x: margin + halfW, y: height - margin - halfH }];
    case "bottom-right":
      return [{ x: width - margin - halfW, y: height - margin - halfH }];
    case "tile": {
      const stepX = Math.max(1, textWidth + textHeight);
      const stepY = Math.max(1, textHeight * 2);
      const reach = Math.hypot(width, height);
      const out: Array<{ x: number; y: number }> = [];
      let row = 0;
      for (let y = height / 2 - reach; y <= height / 2 + reach; y += stepY, row++) {
        const shift = row % 2 === 0 ? 0 : stepX / 2;
        for (let x = width / 2 - reach + shift; x <= width / 2 + reach; x += stepX) {
          out.push({ x, y });
        }
      }
      return out;
    }
  }
}

/** `holiday.jpg` saved as JPG gives `holiday-watermarked.jpg`. */
export function outputName(name: string, type: ImageType): string {
  const base = name.replace(/\.[a-z0-9]{1,5}$/i, "").trim() || "image";
  return `${base}-watermarked.${INPUT_TYPES[type].extension}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
