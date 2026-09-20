// Color math for design-token checks: OKLCH to sRGB, WCAG 2.x contrast, OKLab mixing.
// Pure TypeScript, no dependencies. Validated against reference conversions in color.test.ts.

export interface Rgb {
  /** Gamma-encoded sRGB channels, 0..1. */
  r: number;
  g: number;
  b: number;
  /** Alpha, 0..1. */
  a: number;
}

export interface Oklab {
  L: number;
  a: number;
  b: number;
  alpha: number;
}

const OKLCH_PATTERN =
  /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?)\s*)?\)$/i;

/** Parses `oklch(L C H)` or `oklch(L C H / A)`. L may be a number or a percentage. */
export function parseOklch(input: string): Oklab & { C: number; h: number } {
  const match = OKLCH_PATTERN.exec(input.trim());
  if (!match) throw new Error(`Not an oklch() color: ${input}`);
  const [, l, lPct, c, h, alpha, alphaPct] = match;
  const L = Number(l) / (lPct ? 100 : 1);
  const C = Number(c);
  const hue = Number(h);
  const a = alpha === undefined ? 1 : Number(alpha) / (alphaPct ? 100 : 1);
  const rad = (hue * Math.PI) / 180;
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad), alpha: a, C, h: hue };
}

function encodeSrgb(linear: number): number {
  const v = Math.abs(linear);
  const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.sign(linear) * encoded;
}

function decodeSrgb(encoded: number): number {
  const v = Math.abs(encoded);
  const linear = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return Math.sign(encoded) * linear;
}

/** OKLab to sRGB (Ottosson's matrices). Channels are NOT clamped, so gamut checks can see overshoot. */
export function oklabToSrgb({ L, a, b, alpha }: Oklab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: encodeSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: encodeSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: encodeSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: alpha,
  };
}

export function oklchToSrgb(input: string): Rgb {
  return oklabToSrgb(parseOklch(input));
}

/** True when every channel is inside 0..1 (with a tiny tolerance for rounding). */
export function inGamut({ r, g, b }: Rgb, epsilon = 0.0005): boolean {
  return [r, g, b].every((v) => v >= -epsilon && v <= 1 + epsilon);
}

export function clampRgb(rgb: Rgb): Rgb {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  return { r: c(rgb.r), g: c(rgb.g), b: c(rgb.b), a: rgb.a };
}

export function toHex(rgb: Rgb): string {
  const { r, g, b } = clampRgb(rgb);
  const byte = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

export function toBytes(rgb: Rgb): [number, number, number] {
  const { r, g, b } = clampRgb(rgb);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** WCAG 2.x relative luminance of an opaque color. */
export function relativeLuminance(rgb: Rgb): number {
  const { r, g, b } = clampRgb(rgb);
  return 0.2126 * decodeSrgb(r) + 0.7152 * decodeSrgb(g) + 0.0722 * decodeSrgb(b);
}

/** WCAG 2.x contrast ratio between two opaque colors, 1..21. */
export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Source-over compositing in gamma-encoded sRGB, which is how browsers blend. */
export function composite(top: Rgb, bottom: Rgb): Rgb {
  const a = top.a;
  const mix = (t: number, b: number) => t * a + b * (1 - a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

export function srgbToOklab({ r, g, b, a }: Rgb): Oklab {
  const lr = decodeSrgb(r);
  const lg = decodeSrgb(g);
  const lb = decodeSrgb(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    alpha: a,
  };
}

/** `color-mix(in oklab, first p%, second)` for opaque colors. */
export function mixOklab(first: Rgb, second: Rgb, firstShare: number): Rgb {
  const x = srgbToOklab(first);
  const y = srgbToOklab(second);
  const t = firstShare;
  return oklabToSrgb({
    L: x.L * t + y.L * (1 - t),
    a: x.a * t + y.a * (1 - t),
    b: x.b * t + y.b * (1 - t),
    alpha: 1,
  });
}
