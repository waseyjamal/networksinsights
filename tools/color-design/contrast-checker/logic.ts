// Pure logic of Contrast Checker: the WCAG 2.2 contrast ratio between two opaque sRGB colors, and
// whether it meets each success criterion that sets a ratio.
//
// Relative luminance is L = 0.2126 R + 0.7152 G + 0.0722 B, with each channel c (0 to 1) turned
// linear by c / 12.92 up to 0.04045 and ((c + 0.055) / 1.055) ^ 2.4 above it. The ratio is
// (L1 + 0.05) / (L2 + 0.05) with L1 the lighter color. WCAG says the ratio must not be rounded
// before it is compared with a threshold (4.499:1 does not meet 4.5:1), so a check uses the exact
// ratio, and the ratio is shown rounded down to two decimals, never up.

/** The two colors, as typed: `#rgb` or `#rrggbb`, with or without the `#`. No transparency. */
export interface Input {
  foreground: string;
  background: string;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Check {
  id: string;
  /** The criterion, for example "Normal text, AA". */
  label: string;
  /** The ratio it asks for, for example 4.5. */
  required: number;
  passes: boolean;
}

export type Result =
  | {
      ok: true;
      foreground: string;
      background: string;
      /** The exact ratio. */
      ratio: number;
      /** The ratio rounded down to two decimals, for example "4.54:1". */
      shown: string;
      checks: Check[];
    }
  | { ok: false; field: "foreground" | "background"; error: string };

/** Each row of the table of results: the criterion and the ratio it asks for. */
export const CRITERIA: ReadonlyArray<{ id: string; label: string; required: number }> = [
  { id: "aa-normal", label: "Normal text, AA", required: 4.5 },
  { id: "aa-large", label: "Large text, AA", required: 3 },
  { id: "aaa-normal", label: "Normal text, AAA", required: 7 },
  { id: "aaa-large", label: "Large text, AAA", required: 4.5 },
  { id: "ui", label: "UI components and graphics, AA", required: 3 },
];

const NAMES = { foreground: "text color", background: "background color" } as const;

/** Reads `#rgb` or `#rrggbb`, with or without the `#`, in either case. An error message if not. */
export function parseHex(text: string, field: "foreground" | "background"): Rgb | string {
  const t = text.trim();
  const name = NAMES[field];
  if (t === "" || t === "#") return `Enter the ${name} as a HEX code, such as #767676.`;
  const digits = t.startsWith("#") ? t.slice(1) : t;
  if (!/^[0-9a-f]+$/i.test(digits)) {
    return `The ${name} uses only the digits 0 to 9 and the letters a to f after the #, such as #767676.`;
  }
  if (digits.length === 4 || digits.length === 8) {
    return `The ${name} has transparency (4 or 8 digits), which is not supported. Use 3 or 6 digits.`;
  }
  if (digits.length !== 3 && digits.length !== 6) {
    return `The ${name} needs 3 or 6 digits after the #, such as #767676; this has ${digits.length}.`;
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

/** `#rrggbb` in lowercase. */
export function formatHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** The relative luminance of a color, from 0 (black) to 1 (white). */
export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The exact contrast ratio of two colors, from 1 to 21, whichever is lighter. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A ratio written as "4.54:1", rounded down to two decimals. */
export function formatRatio(ratio: number): string {
  // The small sum only absorbs floating point noise, so that 4.55 is not read as 4.54999....
  return `${(Math.floor(ratio * 100 + 1e-9) / 100).toFixed(2)}:1`;
}

/** The contrast of the two colors and each criterion it meets, or what is wrong with a color. */
export function run(input: Input): Result {
  const foreground = parseHex(input.foreground, "foreground");
  if (typeof foreground === "string") return { ok: false, field: "foreground", error: foreground };
  const background = parseHex(input.background, "background");
  if (typeof background === "string") return { ok: false, field: "background", error: background };
  const ratio = contrastRatio(foreground, background);
  return {
    ok: true,
    foreground: formatHex(foreground),
    background: formatHex(background),
    ratio,
    shown: formatRatio(ratio),
    checks: CRITERIA.map((criterion) => ({ ...criterion, passes: ratio >= criterion.required })),
  };
}
