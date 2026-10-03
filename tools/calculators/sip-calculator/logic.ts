// Pure logic of SIP Calculator: the future value of a fixed monthly investment. Each instalment is
// paid at the start of a month and grows at one twelfth of the yearly rate, compounded monthly:
// FV = P × ((1 + i)^n − 1) / i × (1 + i). Figures are held at full precision and rounded only to show.

/** The largest monthly amount, the highest yearly rate and the longest period the tool accepts. */
export const MAX_AMOUNT = 10_000_000;
export const MAX_RATE = 50;
export const MAX_YEARS = 50;

/** What the tool accepts, as typed. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  /** The amount invested every month. */
  amount: string;
  /** Expected yearly return in percent. */
  rate: string;
  years: string;
}

export interface YearRow {
  year: number;
  /** Everything paid in by the end of this year. */
  invested: number;
  /** The value at the end of this year. */
  value: number;
  /** Value less invested. */
  returns: number;
}

export type Field = "amount" | "rate" | "years";

export type Result =
  | {
      ok: true;
      months: number;
      invested: number;
      returns: number;
      total: number;
      table: YearRow[];
    }
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
  amount: "the monthly investment",
  rate: "the expected yearly return",
  years: "the number of years",
};

function read(text: string, field: Field): number | Result {
  if (text.trim() === "") return { ok: false, field, error: `Enter ${NAMES[field]}.` };
  const value = parseNumber(text);
  if (value === null) {
    return {
      ok: false,
      field,
      error: `${NAMES[field].replace(/^./, (c) => c.toUpperCase())} is not a number. Use digits, with a decimal point if needed, such as 12.5.`,
    };
  }
  return value;
}

/** The value after `months` instalments of `amount`, each paid at the start of a month, at monthly rate `i`. */
export function futureValue(amount: number, i: number, months: number): number {
  if (i === 0) return amount * months;
  return ((amount * ((1 + i) ** months - 1)) / i) * (1 + i);
}

/** The totals and the year-by-year table of a monthly SIP, or what is wrong with the inputs. */
export function run(input: Input): Result {
  const amount = read(input.amount, "amount");
  if (typeof amount !== "number") return amount;
  const rate = read(input.rate, "rate");
  if (typeof rate !== "number") return rate;
  const years = read(input.years, "years");
  if (typeof years !== "number") return years;

  if (amount <= 0) {
    return { ok: false, field: "amount", error: "The monthly investment must be more than 0." };
  }
  if (amount > MAX_AMOUNT) {
    return {
      ok: false,
      field: "amount",
      error: "The monthly investment is too large; the limit is 10,000,000.",
    };
  }
  if (rate < 0 || rate > MAX_RATE) {
    return {
      ok: false,
      field: "rate",
      error: `The expected yearly return must be from 0 to ${MAX_RATE} percent.`,
    };
  }
  if (!Number.isInteger(years) || years < 1 || years > MAX_YEARS) {
    return {
      ok: false,
      field: "years",
      error: `The number of years must be a whole number from 1 to ${MAX_YEARS}.`,
    };
  }

  const i = rate / 12 / 100;
  const table: YearRow[] = [];
  for (let year = 1; year <= years; year += 1) {
    const invested = amount * 12 * year;
    const value = futureValue(amount, i, 12 * year);
    table.push({ year, invested, value, returns: value - invested });
  }
  const last = table[table.length - 1] as YearRow;
  return {
    ok: true,
    months: years * 12,
    invested: last.invested,
    returns: last.returns,
    total: last.value,
    table,
  };
}
