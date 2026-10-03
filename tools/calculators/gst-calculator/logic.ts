// Pure logic of GST Calculator: add GST to a price that excludes it, or take GST out of a price that
// includes it. The GST is split into two equal halves, CGST and SGST, as on an intra-state invoice.
// Figures are held at full precision and rounded only to show.

export type Mode = "add" | "remove";
export const MODES = ["add", "remove"] as const satisfies readonly Mode[];

/** The GST slabs found in force on SLABS_CHECKED, offered as quick buttons. */
export const SLABS = ["5", "18", "40"] as const;
/** The date the slabs were checked against the official source. */
export const SLABS_CHECKED = "3 October 2026";

/** The largest amount and the highest rate the tool accepts. */
export const MAX_AMOUNT = 1e12;
export const MAX_RATE = 100;

/** What the tool accepts, as typed. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  amount: string;
  /** GST rate in percent. */
  rate: string;
  mode: Mode;
}

export type Field = "amount" | "rate";

export type Result =
  | { ok: true; base: number; gst: number; cgst: number; sgst: number; total: number }
  | { ok: false; field: Field; error: string };

/**
 * Reads a number from text: an optional sign, digits with an optional decimal point, and commas
 * only as well-formed thousands separators. Returns null when it is not one.
 */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(/^\+/, "");
  const grouped = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t);
  const plain = /^-?(\d+\.?\d*|\.\d+)$/.test(t);
  if (!grouped && !plain) return null;
  const value = Number(grouped ? t.replaceAll(",", "") : t);
  return Number.isFinite(value) ? value : null;
}

const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** A figure as shown: grouped digits and two decimals, never "-0.00". */
export function formatMoney(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return money.format(rounded === 0 ? 0 : rounded);
}

/** The base, the GST, its two halves and the total, or what is wrong with the inputs. */
export function run(input: Input): Result {
  if (input.amount.trim() === "") return { ok: false, field: "amount", error: "Enter the amount." };
  const amount = parseNumber(input.amount);
  if (amount === null) {
    return {
      ok: false,
      field: "amount",
      error:
        "The amount is not a number. Use digits, with a decimal point if needed, such as 1499.50.",
    };
  }
  if (amount < 0) return { ok: false, field: "amount", error: "The amount cannot be negative." };
  if (amount > MAX_AMOUNT) {
    return {
      ok: false,
      field: "amount",
      error: "The amount is too large; the limit is 1,000,000,000,000.",
    };
  }
  if (input.rate.trim() === "") return { ok: false, field: "rate", error: "Enter the GST rate." };
  const rate = parseNumber(input.rate);
  if (rate === null || rate < 0 || rate > MAX_RATE) {
    return {
      ok: false,
      field: "rate",
      error: `The GST rate must be a number from 0 to ${MAX_RATE} percent.`,
    };
  }

  const base = input.mode === "add" ? amount : (amount * 100) / (100 + rate);
  const gst = input.mode === "add" ? (amount * rate) / 100 : amount - base;
  const total = input.mode === "add" ? amount + gst : amount;
  return { ok: true, base, gst, cgst: gst / 2, sgst: gst / 2, total };
}
