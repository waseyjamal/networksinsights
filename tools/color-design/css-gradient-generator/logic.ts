// Pure logic of "CSS Gradient Generator": the rules for colour stops and angles, and the CSS text
// they make, with no DOM, no network and no top-level statements (docs/tool-contract.md).

export const KINDS = ["linear", "radial", "conic"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABELS: Readonly<Record<Kind, string>> = {
  linear: "Linear",
  radial: "Radial",
  conic: "Conic",
};

export const SHAPES = ["circle", "ellipse"] as const;
export type Shape = (typeof SHAPES)[number];

export const LIMITS = { minStops: 2, maxStops: 6, maxAngle: 360 } as const;

export interface Stop {
  /** A HEX colour as typed: #rgb or #rrggbb, without alpha. */
  color: string;
  /** Percent along the gradient, 0 to 100. */
  position: number;
}

export interface Input {
  kind: Kind;
  /** Degrees, 0 to 360: the direction of a linear gradient, the start of a conic one. */
  angle: number;
  /** The shape of a radial gradient. */
  shape: Shape;
  stops: Stop[];
}

export type Result = { ok: true; css: string; value: string } | { ok: false; error: string };

/** "#F80" or "f80" gives "#ff8800"; anything that is not 3 or 6 HEX digits gives null. */
export function normalizeHex(text: string): string | null {
  const digits = text.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(digits)) return `#${digits}`;
  if (/^[0-9a-f]{3}$/.test(digits)) {
    return `#${[...digits].map((digit) => digit + digit).join("")}`;
  }
  return null;
}

export function run(input: Input): Result {
  const { stops } = input;
  if (stops.length < LIMITS.minStops || stops.length > LIMITS.maxStops) {
    return {
      ok: false,
      error: `A gradient here has ${LIMITS.minStops} to ${LIMITS.maxStops} colour stops; this has ${stops.length}.`,
    };
  }
  if (!Number.isFinite(input.angle) || input.angle < 0 || input.angle > LIMITS.maxAngle) {
    return { ok: false, error: "The angle must be a number from 0 to 360 degrees." };
  }
  const parts: string[] = [];
  for (const [index, stop] of stops.entries()) {
    const color = normalizeHex(stop.color);
    if (!color) {
      return {
        ok: false,
        error: `Stop ${index + 1}: use a HEX colour with 3 or 6 digits, such as #3b82f6.`,
      };
    }
    if (!Number.isFinite(stop.position) || stop.position < 0 || stop.position > 100) {
      return { ok: false, error: `Stop ${index + 1}: the position must be from 0 to 100%.` };
    }
    parts.push(`${color} ${round(stop.position)}%`);
  }
  const list = parts.join(", ");
  const angle = round(input.angle);
  let value: string;
  if (input.kind === "linear") value = `linear-gradient(${angle}deg, ${list})`;
  else if (input.kind === "radial") value = `radial-gradient(${input.shape}, ${list})`;
  else value = `conic-gradient(from ${angle}deg, ${list})`;
  return { ok: true, value, css: `background-image: ${value};` };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Spreads `count` stops evenly from 0 to 100%, keeping their colours. */
export function spread(colors: readonly string[]): Stop[] {
  const last = Math.max(1, colors.length - 1);
  return colors.map((color, index) => ({ color, position: Math.round((index / last) * 100) }));
}
