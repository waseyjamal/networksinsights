// Pure logic of Color Converter: read a color written as HEX, RGB or HSL, and write it in all three.
// Every color is held as three whole RGB channels from 0 to 255, the precision of a HEX code, so
// HSL is rounded to whole degrees and percentages when it is written.

/** The formats the tool reads and writes, in the order the page shows them. */
export const FORMATS = ["hex", "rgb", "hsl"] as const;
export type Format = (typeof FORMATS)[number];

export const FORMAT_LABELS: Readonly<Record<Format, string>> = {
  hex: "HEX",
  rgb: "RGB",
  hsl: "HSL",
};

/** The longest text a field is read from; anything longer cannot be a color. */
export const MAX_LENGTH = 64;

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  format: Format;
  text: string;
}

/** Red, green and blue, each a whole number from 0 to 255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Hue in degrees from 0 to under 360, saturation and lightness in percent from 0 to 100. */
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export type Texts = Record<Format, string>;

export type Result =
  | { ok: true; rgb: Rgb; texts: Texts }
  | { ok: false; reason: "empty" | "invalid"; error: string };

/** "a HEX color", "an RGB color", "an HSL color". */
const NAMES: Readonly<Record<Format, string>> = {
  hex: "a HEX color",
  rgb: "an RGB color",
  hsl: "an HSL color",
};

const EXAMPLES: Readonly<Record<Format, string>> = {
  hex: "#3b82f6",
  rgb: "rgb(59, 130, 246)",
  hsl: "hsl(217, 91%, 60%)",
};

/** Reads `text` as a color in `format`, and writes that color in every format. */
export function run(input: Input): Result {
  const text = input.text.trim();
  if (text === "") {
    return {
      ok: false,
      reason: "empty",
      error: `Enter ${NAMES[input.format]}, such as ${EXAMPLES[input.format]}.`,
    };
  }
  const parsed =
    text.length > MAX_LENGTH
      ? `This is too long to be ${NAMES[input.format]}.`
      : input.format === "hex"
        ? parseHex(text)
        : input.format === "rgb"
          ? parseRgb(text)
          : parseHsl(text);
  if (typeof parsed === "string") return { ok: false, reason: "invalid", error: parsed };
  const rgb = "h" in parsed ? hslToRgb(parsed) : parsed;
  const texts = formatAll(rgb);
  // An HSL color keeps the exact values it was given, rather than the rounded trip through RGB.
  if ("h" in parsed) texts.hsl = formatHsl(parsed);
  return { ok: true, rgb, texts };
}

/** The color in every format. */
export function formatAll(rgb: Rgb): Texts {
  return { hex: formatHex(rgb), rgb: formatRgb(rgb), hsl: formatHsl(rgbToHsl(rgb)) };
}

/** `#rrggbb` in lowercase, the form a color picker takes. */
export function formatHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function formatRgb({ r, g, b }: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

export function formatHsl({ h, s, l }: Hsl): string {
  return `hsl(${round(h)}, ${round(s)}%, ${round(l)}%)`;
}

/** Reads `#rgb` or `#rrggbb`, with or without the `#`, in either case. An error message if not. */
export function parseHex(text: string): Rgb | string {
  const digits = text.startsWith("#") ? text.slice(1) : text;
  if (!/^[0-9a-f]+$/i.test(digits)) {
    return `A HEX color uses only the digits 0 to 9 and the letters a to f after the #, such as ${EXAMPLES.hex}.`;
  }
  if (digits.length === 4 || digits.length === 8) {
    return "HEX codes with transparency (4 or 8 digits) are not supported. Use 3 or 6 digits.";
  }
  if (digits.length !== 3 && digits.length !== 6) {
    return `A HEX color has 3 or 6 digits after the #, such as ${EXAMPLES.hex}; this has ${digits.length}.`;
  }
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/**
 * Reads `rgb(59, 130, 246)`, `rgb(59 130 246)` or the three numbers alone. Decimals are rounded to
 * the nearest whole number. An error message if not.
 */
export function parseRgb(text: string): Rgb | string {
  const usage = `An RGB color is three numbers from 0 to 255, such as ${EXAMPLES.rgb}.`;
  const values = splitValues(text, "rgb");
  if (values?.length !== 3) return usage;
  const channels: number[] = [];
  for (const [index, value] of values.entries()) {
    if (value.endsWith("%")) return `Percentages are not supported in RGB. ${usage}`;
    if (!/^\d+(\.\d+)?$/.test(value)) return usage;
    const number = Number(value);
    if (number > 255) {
      return `${"Red Green Blue".split(" ")[index]} is ${value}; each RGB value must be from 0 to 255.`;
    }
    channels.push(Math.round(number));
  }
  const [r = 0, g = 0, b = 0] = channels;
  return { r, g, b };
}

/**
 * Reads `hsl(217, 91%, 60%)`, `hsl(217deg 91% 60%)` or the three values alone; the percent signs
 * are optional. An error message if not.
 */
export function parseHsl(text: string): Hsl | string {
  const usage = `An HSL color is a hue from 0 to 360 and two percentages from 0 to 100, such as ${EXAMPLES.hsl}.`;
  const values = splitValues(text, "hsl");
  if (values?.length !== 3) return usage;
  const [hue = "", saturation = "", lightness = ""] = values;
  if (!/^\d+(\.\d+)?(deg)?$/i.test(hue)) return usage;
  const h = Number(hue.replace(/deg$/i, ""));
  if (h > 360) return `The hue is ${h}; it must be from 0 to 360 degrees.`;
  const percents: number[] = [];
  for (const [index, value] of [saturation, lightness].entries()) {
    if (!/^\d+(\.\d+)?%?$/.test(value)) return usage;
    const number = Number(value.replace(/%$/, ""));
    if (number > 100) {
      return `${index === 0 ? "Saturation" : "Lightness"} is ${number}%; it must be from 0 to 100%.`;
    }
    percents.push(number);
  }
  const [s = 0, l = 0] = percents;
  return { h: h === 360 ? 0 : h, s, l };
}

/** HSL of an RGB color, unrounded. A gray has hue 0 and saturation 0. */
export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l: l * 100 };
  const s = delta / (1 - Math.abs(2 * l - 1));
  const sector =
    max === red
      ? ((green - blue) / delta) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  const h = (sector * 60 + 360) % 360;
  return { h, s: s * 100, l: l * 100 };
}

/** RGB of an HSL color, each channel rounded to a whole number. */
export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [red, green, blue] =
    sector < 1
      ? [chroma, x, 0]
      : sector < 2
        ? [x, chroma, 0]
        : sector < 3
          ? [0, chroma, x]
          : sector < 4
            ? [0, x, chroma]
            : sector < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const m = lightness - chroma / 2;
  const channel = (value: number) => Math.round((value + m) * 255);
  return { r: channel(red), g: channel(green), b: channel(blue) };
}

/** The values inside `name(...)`, or of the bare list, split on commas or spaces. */
function splitValues(text: string, name: "rgb" | "hsl"): string[] | null {
  const call = (name === "rgb" ? /^rgb\s*\((.*)\)$/i : /^hsl\s*\((.*)\)$/i).exec(text);
  const inner = (call ? (call[1] ?? "") : text).trim();
  if (inner === "" || /[()]/.test(inner)) return null;
  return inner.split(/\s*,\s*|\s+/);
}

/** Rounds to a whole number, and never writes -0. */
function round(value: number): number {
  return Math.round(value) + 0;
}
