// Pure logic of FD Calculator: the maturity value of a fixed deposit. With compounding,
// A = P × (1 + r / n)^(n × t), where n is the number of compounding periods a year and t the tenure
// in years; a tenure in days is t = days / 365. With simple interest paid at maturity,
// A = P × (1 + r × t). Figures are held at full precision and rounded only to show.

export type Unit = "years" | "months" | "days";
export const TENURE_UNITS = ["years", "months", "days"] as const satisfies readonly Unit[];
export type Compounding = "monthly" | "quarterly" | "half-yearly" | "yearly" | "simple";
export const COMPOUNDINGS = [
  "monthly",
  "quarterly",
  "half-yearly",
  "yearly",
  "simple",
] as const satisfies readonly Compounding[];

/** Compounding periods a year; simple interest has none. */
export const PERIODS: Readonly<Record<Exclude<Compounding, "simple">, number>> = {
  monthly: 12,
  quarterly: 4,
  "half-yearly": 2,
  yearly: 1,
};

/** The largest deposit, the highest yearly rate and the longest tenure the tool accepts. */
export const MAX_AMOUNT = 1e12;
export const MAX_RATE = 50;
export const MAX_TENURE: Readonly<Record<Unit, number>> = { years: 50, months: 600, days: 18250 };
/** Days in a year, for a tenure in days. Our own choice; banks may count otherwise. */
export const DAYS_IN_YEAR = 365;

/** What the tool accepts, as typed. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  amount: string;
  /** Yearly interest rate in percent. */
  rate: string;
  tenure: string;
  unit: Unit;
  compounding: Compounding;
}

export interface YearRow {
  /** "1", "2", … or "At maturity" for a final part year. */
  label: string;
  value: number;
  interest: number;
}

export type Field = "amount" | "rate" | "tenure";

export type Result =
  | { ok: true; maturity: number; interest: number; years: number; table: YearRow[] }
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

const NAMES: Readonly<Record<Field, string>> = {
  amount: "the deposit amount",
  rate: "the yearly interest rate",
  tenure: "the tenure",
};

function read(text: string, field: Field): number | Result {
  if (text.trim() === "") return { ok: false, field, error: `Enter ${NAMES[field]}.` };
  const value = parseNumber(text);
  if (value === null) {
    return {
      ok: false,
      field,
      error: `${NAMES[field].replace(/^./, (c) => c.toUpperCase())} is not a number. Use digits, with a decimal point if needed, such as 7.25.`,
    };
  }
  return value;
}

/** The value of `amount` after `years` at yearly rate `r` (0.07 is 7%). */
export function valueAfter(amount: number, r: number, years: number, compounding: Compounding) {
  if (compounding === "simple") return amount * (1 + r * years);
  const n = PERIODS[compounding];
  return amount * (1 + r / n) ** (n * years);
}

/** The maturity amount, the interest and the year-by-year table, or what is wrong with the inputs. */
export function run(input: Input): Result {
  const amount = read(input.amount, "amount");
  if (typeof amount !== "number") return amount;
  const rate = read(input.rate, "rate");
  if (typeof rate !== "number") return rate;
  const tenure = read(input.tenure, "tenure");
  if (typeof tenure !== "number") return tenure;

  if (amount <= 0) {
    return { ok: false, field: "amount", error: "The deposit amount must be more than 0." };
  }
  if (amount > MAX_AMOUNT) {
    return {
      ok: false,
      field: "amount",
      error: "The deposit amount is too large; the limit is 1,000,000,000,000.",
    };
  }
  if (rate < 0 || rate > MAX_RATE) {
    return {
      ok: false,
      field: "rate",
      error: `The yearly interest rate must be from 0 to ${MAX_RATE} percent.`,
    };
  }
  const max = MAX_TENURE[input.unit];
  if (!Number.isInteger(tenure) || tenure < 1 || tenure > max) {
    return {
      ok: false,
      field: "tenure",
      error: `The tenure must be a whole number from 1 to ${max.toLocaleString("en-US")} ${input.unit}.`,
    };
  }

  const years =
    input.unit === "years" ? tenure : input.unit === "months" ? tenure / 12 : tenure / DAYS_IN_YEAR;
  const r = rate / 100;
  const table: YearRow[] = [];
  for (let year = 1; year <= Math.floor(years); year += 1) {
    const value = valueAfter(amount, r, year, input.compounding);
    table.push({ label: String(year), value, interest: value - amount });
  }
  const maturity = valueAfter(amount, r, years, input.compounding);
  if (!Number.isInteger(years)) {
    table.push({ label: "At maturity", value: maturity, interest: maturity - amount });
  }
  return { ok: true, maturity, interest: maturity - amount, years, table };
}
