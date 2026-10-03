// Pure logic of "Box Shadow Generator": the rules for shadow layers and the CSS they make, with no
// DOM, no network and no top-level statements (docs/tool-contract.md).

/**
 * The ranges of the sliders, in CSS pixels. They are our own choice, wide enough for any card or
 * button; CSS itself has no upper limit.
 */
export const RANGES = {
  offset: { min: -100, max: 100 },
  blur: { min: 0, max: 100 },
  spread: { min: -50, max: 50 },
  opacity: { min: 0, max: 100 },
} as const;

export const MAX_LAYERS = 5;

/** The blur of the glass card preset's backdrop, in pixels. */
export const GLASS_BLUR = 12;

export interface Layer {
  x: number;
  y: number;
  blur: number;
  spread: number;
  /** HEX colour, #rgb or #rrggbb. */
  color: string;
  /** Percent, 0 to 100. */
  opacity: number;
  inset: boolean;
}

export interface Input {
  layers: Layer[];
  /** Adds the glass card lines: a see-through fill and a blurred backdrop. */
  glass: boolean;
}

export type Result = { ok: true; css: string; shadow: string } | { ok: false; error: string };

export function hexToRgb(text: string): { r: number; g: number; b: number } | null {
  const digits = text.trim().replace(/^#/, "").toLowerCase();
  const full = /^[0-9a-f]{3}$/.test(digits)
    ? [...digits].map((digit) => digit + digit).join("")
    : digits;
  if (!/^[0-9a-f]{6}$/.test(full)) return null;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

const FIELDS = [
  ["x", "Horizontal offset", RANGES.offset],
  ["y", "Vertical offset", RANGES.offset],
  ["blur", "Blur", RANGES.blur],
  ["spread", "Spread", RANGES.spread],
  ["opacity", "Opacity", RANGES.opacity],
] as const;

export function layerCss(layer: Layer): string {
  const rgb = hexToRgb(layer.color) ?? { r: 0, g: 0, b: 0 };
  const alpha = Math.round(layer.opacity) / 100;
  const parts = [`${layer.x}px`, `${layer.y}px`, `${layer.blur}px`, `${layer.spread}px`];
  const color = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  return `${layer.inset ? "inset " : ""}${parts.join(" ")} ${color}`;
}

export function run(input: Input): Result {
  if (input.layers.length < 1 || input.layers.length > MAX_LAYERS) {
    return {
      ok: false,
      error: `A shadow here has 1 to ${MAX_LAYERS} layers; this has ${input.layers.length}.`,
    };
  }
  for (const [index, layer] of input.layers.entries()) {
    for (const [key, label, range] of FIELDS) {
      const value = layer[key];
      if (!Number.isFinite(value) || value < range.min || value > range.max) {
        return {
          ok: false,
          error: `Layer ${index + 1}: ${label} must be from ${range.min} to ${range.max}.`,
        };
      }
    }
    if (!hexToRgb(layer.color)) {
      return {
        ok: false,
        error: `Layer ${index + 1}: use a HEX colour with 3 or 6 digits, such as #000000.`,
      };
    }
  }
  const shadow = input.layers.map(layerCss).join(", ");
  const lines = [`box-shadow: ${shadow};`];
  if (input.glass) {
    lines.push(
      "background-color: rgba(255, 255, 255, 0.15);",
      `backdrop-filter: blur(${GLASS_BLUR}px);`,
      `-webkit-backdrop-filter: blur(${GLASS_BLUR}px);`,
      "border: 1px solid rgba(255, 255, 255, 0.3);",
    );
  }
  return { ok: true, shadow, css: lines.join("\n") };
}

export const DEFAULT_LAYER: Layer = {
  x: 0,
  y: 4,
  blur: 12,
  spread: 0,
  color: "#000000",
  opacity: 25,
  inset: false,
};

/** The glass card preset: a soft drop shadow and a faint inner highlight. */
export const GLASS_LAYERS: Layer[] = [
  { x: 0, y: 8, blur: 32, spread: 0, color: "#000000", opacity: 20, inset: false },
  { x: 0, y: 1, blur: 0, spread: 0, color: "#ffffff", opacity: 40, inset: true },
];
