// Pure logic of Percentage Calculator: four percentage questions on two numbers typed as text.
// Numbers are read from text so that an empty or unreadable box can say what is wrong.

/** The four questions the tool answers, in the order the page lists them. */
export const MODES = ["of", "whatPercent", "change", "addSub"] as const;
export type Mode = (typeof MODES)[number];

export const MODE_LABELS: Readonly<Record<Mode, string>> = {
  of: "X% of Y",
  whatPercent: "X is what % of Y",
  change: "Percentage change from X to Y",
  addSub: "Add or subtract X% to Y",
};

export type Operation = "add" | "subtract";

/** The two boxes of each mode: the label the visitor sees. */
export const FIELD_LABELS: Readonly<Record<Mode, { a: string; b: string }>> = {
  of: { a: "Percent (X)", b: "Number (Y)" },
  whatPercent: { a: "Number (X)", b: "Total (Y)" },
  change: { a: "From (X)", b: "To (Y)" },
  addSub: { a: "Percent (X)", b: "Number (Y)" },
};

/** The largest size, in either direction, a typed number may have. */
export const MAX_ABS = 1e15;

/** The most decimal places a result is shown with; trailing zeros are dropped. */
export const MAX_DECIMALS = 6;

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  mode: Mode;
  a: string;
  b: string;
  /** Only read by the "addSub" mode. */
  operation: Operation;
}

export interface Extra {
  label: string;
  value: string;
}

export type Result =
  | {
      ok: true;
      /** The answer as a number. */
      value: number;
      /** The answer as shown: grouped digits, a % sign when it is a percentage. */
      text: string;
      /** The question and its answer as one sentence. */
      sentence: string;
      /** The working, as the formula with the typed numbers in it. */
      working: string;
      /** Other numbers worth showing next to the answer. */
      extras: Extra[];
    }
  | { ok: false; field: "a" | "b"; error: string };

/**
 * Reads a number from text: an optional sign, digits with an optional decimal point, and commas
 * only as well-formed thousands separators ("1,234.5"). Returns null when it is not one.
 */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(/^\+/, "");
  const grouped = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t);
  const plain = /^-?(\d+\.?\d*|\.\d+)$/.test(t);
  if (!grouped && !plain) return null;
  const value = Number(grouped ? t.replaceAll(",", "") : t);
  return Number.isFinite(value) ? value : null;
}

const group = new Intl.NumberFormat("en-US", { maximumFractionDigits: MAX_DECIMALS });

/** A number as shown: grouped, rounded to MAX_DECIMALS, never "-0". */
export function formatNumber(value: number): string {
  const rounded = Number(value.toFixed(MAX_DECIMALS));
  return group.format(Object.is(rounded, -0) ? 0 : rounded);
}

function readField(text: string, label: string, field: "a" | "b"): number | Result {
  if (text.trim() === "") {
    return { ok: false, field, error: `Enter a number for ${label}.` };
  }
  const value = parseNumber(text);
  if (value === null) {
    return {
      ok: false,
      field,
      error: `${label} is not a number. Use digits, with a decimal point if needed, such as 12.5.`,
    };
  }
  if (Math.abs(value) > MAX_ABS) {
    return {
      ok: false,
      field,
      error: `${label} is too large; the limit is 1,000,000,000,000,000.`,
    };
  }
  return value;
}

function done(
  value: number,
  text: string,
  sentence: string,
  working: string,
  extras: Extra[],
): Result {
  if (!Number.isFinite(value)) {
    return { ok: false, field: "b", error: "The result is too large to show." };
  }
  return { ok: true, value, text, sentence, working, extras };
}

/** Answers the question of `input.mode` for the two numbers, or says what is wrong with them. */
export function run(input: Input): Result {
  const labels = FIELD_LABELS[input.mode];
  const a = readField(input.a, labels.a, "a");
  if (typeof a !== "number") return a;
  const b = readField(input.b, labels.b, "b");
  if (typeof b !== "number") return b;

  const A = formatNumber(a);
  const B = formatNumber(b);

  switch (input.mode) {
    case "of": {
      const value = (a * b) / 100;
      const text = formatNumber(value);
      return done(value, text, `${A}% of ${B} is ${text}.`, `${A} × ${B} ÷ 100`, []);
    }
    case "whatPercent": {
      if (b === 0) {
        return {
          ok: false,
          field: "b",
          error: "The total (Y) cannot be 0: no number is a percent of 0.",
        };
      }
      const value = (a * 100) / b;
      const text = `${formatNumber(value)}%`;
      return done(value, text, `${A} is ${text} of ${B}.`, `${A} ÷ ${B} × 100`, []);
    }
    case "change": {
      if (a === 0) {
        return {
          ok: false,
          field: "a",
          error: "The starting value (X) cannot be 0: a change from 0 has no percentage.",
        };
      }
      const value = ((b - a) * 100) / Math.abs(a);
      const text = `${formatNumber(value)}%`;
      const word = value > 0 ? "an increase" : value < 0 ? "a decrease" : "no change";
      const size = value === 0 ? "" : ` of ${formatNumber(Math.abs(value))}%`;
      return done(
        value,
        text,
        `From ${A} to ${B} is ${word}${size}.`,
        `(${B} − ${A}) ÷ |${A}| × 100`,
        [{ label: "Difference", value: formatNumber(b - a) }],
      );
    }
    case "addSub": {
      const part = (a * b) / 100;
      const adding = input.operation === "add";
      const value = adding ? b + part : b - part;
      const text = formatNumber(value);
      return done(
        value,
        text,
        `${adding ? "Adding" : "Subtracting"} ${A}% ${adding ? "to" : "from"} ${B} gives ${text}.`,
        `${B} ${adding ? "+" : "−"} (${B} × ${A} ÷ 100)`,
        [{ label: `${A}% of ${B}`, value: formatNumber(part) }],
      );
    }
  }
}
