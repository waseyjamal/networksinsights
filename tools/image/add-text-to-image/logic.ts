// Pure logic of "Add Text to Image": the file rules, the text layers and their settings, and where
// each line of text is drawn, with no DOM, no network and no top-level statements
// (docs/tool-contract.md). ui.tsx shows the layers over the photo and draws the final picture on a
// canvas from the same numbers, so what is seen is what is saved.

export const LIMITS = {
  maxInputBytes: 25 * 1024 * 1024,
  maxFiles: 1,
  /** Text layers on one picture: our own choice. */
  maxLayers: 10,
  /** Characters in one layer, line breaks included: our own choice. */
  maxTextLength: 200,
} as const;

/**
 * The largest picture: 16,777,216 pixels, 4,096 by 4,096, the largest canvas Safari on iPhone and
 * iPad allows, so the final picture can be drawn on every device.
 */
export const MAX_PIXELS = 4096 * 4096;

/** JPG and WebP are saved again at this quality: our own choice, high so little is lost. */
export const QUALITY = 0.92;

/** A line is this many times the text size apart from the next, as the preview shows it. */
export const LINE_HEIGHT = 1.2;

/** Fonts every system has in some form; no web font is loaded. */
export const FONTS = {
  sans: { label: "Sans serif (Arial, Helvetica)", css: "Arial, Helvetica, sans-serif" },
  serif: { label: "Serif (Georgia, Times)", css: 'Georgia, "Times New Roman", Times, serif' },
  mono: { label: "Monospace (Courier)", css: '"Courier New", Courier, monospace' },
  verdana: { label: "Verdana", css: "Verdana, Geneva, sans-serif" },
  impact: { label: "Impact", css: 'Impact, "Arial Black", sans-serif' },
} as const;

export type Font = keyof typeof FONTS;

export const RANGES = {
  /** Text height as a percent of the picture's width. */
  size: { min: 1, max: 40 },
  /** Outline thickness as a percent of the text height. */
  outline: { min: 0, max: 20 },
  /** Position of the text's top left corner, as a percent of the picture. */
  x: { min: 0, max: 100 },
  y: { min: 0, max: 100 },
} as const;

export const INPUT_TYPES = {
  "image/jpeg": { label: "JPG", extension: "jpg" },
  "image/png": { label: "PNG", extension: "png" },
  "image/webp": { label: "WebP", extension: "webp" },
} as const;

export type ImageType = keyof typeof INPUT_TYPES;

export interface Layer {
  id: string;
  text: string;
  font: Font;
  bold: boolean;
  /** Percent of the picture's width. */
  size: number;
  /** HEX colours, #rrggbb. */
  color: string;
  outline: number;
  outlineColor: string;
  shadow: boolean;
  /** Top left corner, percent of the picture's width and height. */
  x: number;
  y: number;
}

/** Kept for the manifest's input schema. */
export interface Input {
  layers: Omit<Layer, "id">[];
}

export const MESSAGES = {
  notAnImage: "This file is not a JPG, PNG or WebP image.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  unreadable: "This image could not be read. It may be damaged.",
  tooManyPixels:
    "This image has more than 16.7 megapixels (4,096 by 4,096), more than some phones can draw. Make it smaller with Resize Image first.",
  noText: "Type the text of this layer.",
  longText: `A layer can hold at most ${LIMITS.maxTextLength} characters.`,
  tooManyLayers: `Up to ${LIMITS.maxLayers} text layers can be added.`,
  noLayers: "Add at least one text layer with text in it.",
  color: "Use a HEX colour with 6 digits, such as #ffffff.",
  range: (label: string, min: number, max: number) => `${label} must be from ${min} to ${max}.`,
  failed: "The picture could not be saved.",
  noWebp:
    "Your browser cannot write WebP pictures (Safari cannot), so the picture was saved as PNG instead.",
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

/** A new layer, placed a little lower for each layer already there. */
export function newLayer(id: string, index: number): Layer {
  return {
    id,
    text: index === 0 ? "Your text" : `Text ${index + 1}`,
    font: "sans",
    bold: true,
    size: 8,
    color: "#ffffff",
    outline: 6,
    outlineColor: "#000000",
    shadow: false,
    x: 5,
    y: Math.min(90, 5 + index * 12),
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Every problem with a layer, by field; an empty object when it can be drawn. */
export function checkLayer(layer: Layer): Partial<Record<keyof Layer, string>> {
  const errors: Partial<Record<keyof Layer, string>> = {};
  if (layer.text.trim() === "") errors.text = MESSAGES.noText;
  else if ([...layer.text].length > LIMITS.maxTextLength) errors.text = MESSAGES.longText;
  if (!HEX.test(layer.color)) errors.color = MESSAGES.color;
  if (!HEX.test(layer.outlineColor)) errors.outlineColor = MESSAGES.color;
  for (const [key, label] of [
    ["size", "Text size"],
    ["outline", "Outline"],
    ["x", "Left"],
    ["y", "Top"],
  ] as const) {
    const { min, max } = RANGES[key];
    const value = layer[key];
    if (!Number.isFinite(value) || value < min || value > max) {
      errors[key] = MESSAGES.range(label, min, max);
    }
  }
  return errors;
}

/** The first problem with the layers, or null when the picture can be saved. */
export function checkLayers(layers: readonly Layer[]): string | null {
  if (layers.length === 0) return MESSAGES.noLayers;
  if (layers.length > LIMITS.maxLayers) return MESSAGES.tooManyLayers;
  for (const layer of layers) {
    const problem = Object.values(checkLayer(layer))[0];
    if (problem) return problem;
  }
  return null;
}

/** The CSS font of a layer at a size in pixels, for a canvas. */
export function cssFont(layer: Pick<Layer, "font" | "bold">, pixels: number): string {
  return `${layer.bold ? "bold " : ""}${pixels}px ${FONTS[layer.font].css}`;
}

export interface DrawnLine {
  text: string;
  /** Pixels from the left and from the top of the picture to the top of the line's text. */
  x: number;
  y: number;
}

/**
 * How a layer is drawn on a picture of `width` by `height` pixels: the text size in pixels, the
 * outline and shadow in pixels, and each line with its place. A line sits in a box LINE_HEIGHT
 * times the text size, with the text centred in it, as a browser lays out text.
 */
export function layout(layer: Layer, width: number, height: number) {
  const pixels = Math.max(1, (layer.size / 100) * width);
  const left = (layer.x / 100) * width;
  const top = (layer.y / 100) * height;
  const gap = ((LINE_HEIGHT - 1) / 2) * pixels;
  const lines: DrawnLine[] = layer.text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((text, index) => ({ text, x: left, y: top + gap + index * LINE_HEIGHT * pixels }));
  return {
    pixels,
    /** The stroke is centred on the letter edges, so it is drawn twice as wide. */
    outlineWidth: (layer.outline / 100) * pixels * 2,
    shadowBlur: pixels * 0.15,
    shadowOffset: pixels * 0.06,
    lines,
  };
}

/** `holiday.jpg` saved as JPG gives `holiday-text.jpg`. */
export function outputName(name: string, type: ImageType): string {
  const base = name.replace(/\.[a-z0-9]{1,5}$/i, "").trim() || "image";
  return `${base}-text.${INPUT_TYPES[type].extension}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
