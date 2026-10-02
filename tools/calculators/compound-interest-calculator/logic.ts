// Pure logic of Compound Interest Calculator: a sum that earns interest, with the interest added to
// the balance every compounding period, and an optional regular deposit.
//
// The yearly rate is divided by the number of periods in a year. At the end of each period the
// balance first earns that period's interest, then the deposit is added. Nothing here is a forecast:
// it is arithmetic on the numbers typed, with a constant rate.

export const FREQUENCIES = ["1", "2", "4", "12", "52", "365"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_LABELS: Readonly<Record<Frequency, string>> = {
  "1": "Yearly",
  "2": "Half-yearly",
  "4": "Quarterly",
  "12": "Monthly",
  "52": "Weekly",
  "365": "Daily",
};

/** The limits of what is accepted, and of what is shown. */
export const MAX_AMOUNT = 1e12;
export const MAX_RATE = 100;
export const MAX_YEARS = 100;
export const MAX_BALANCE = 1e15;

/** What the tool accepts, as typed. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  principal: string;
  /** Yearly interest rate in percent. */
  rate: string;
  years: string;
  frequency: Frequency;
  /** Added at the end of every compounding period. An empty box counts as 0. */
  deposit: string;
}

export interface YearRow {
  year: number;
  start: number;
  deposits: number;
  interest: number;
  end: number;
}

export type Field = "principal" | "rate" | "years" | "deposit";

export type Result =
  | {
      ok: true;
      endBalance: number;
      /** The principal plus every deposit. */
      contributed: number;
      interest: number;
      years: YearRow[];
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
  principal: "the starting amount",
  rate: "the yearly interest rate",
  years: "the number of years",
  deposit: "the regular deposit",
};

function read(text: string, field: Field): number | Result {
  const value = parseNumber(text);
  if (value === null) {
    return {
      ok: false,
      field,
      error: `${NAMES[field].replace(/^./, (c) => c.toUpperCase())} is not a number. Use digits, with a decimal point if needed, such as 5.5.`,
    };
  }
  return value;
}

/** The balance after each year, the interest earned and what was put in, or what is wrong. */
export function run(input: Input): Result {
  if (input.principal.trim() === "") {
    return {
      ok: false,
      field: "principal",
      error: "Enter the starting amount, or 0 if you start with none.",
    };
  }
  const principal = read(input.principal, "principal");
  if (typeof principal !== "number") return principal;
  if (input.rate.trim() === "") {
    return { ok: false, field: "rate", error: "Enter the yearly interest rate." };
  }
  const rate = read(input.rate, "rate");
  if (typeof rate !== "number") return rate;
  if (input.years.trim() === "") {
    return { ok: false, field: "years", error: "Enter the number of years." };
  }
  const years = read(input.years, "years");
  if (typeof years !== "number") return years;
  let deposit = 0;
  if (input.deposit.trim() !== "") {
    const parsed = read(input.deposit, "deposit");
    if (typeof parsed !== "number") return parsed;
    deposit = parsed;
  }

  if (principal < 0 || principal > MAX_AMOUNT) {
    return {
      ok: false,
      field: "principal",
      error: "The starting amount must be from 0 to 1,000,000,000,000.",
    };
  }
  if (rate < 0 || rate > MAX_RATE) {
    return {
      ok: false,
      field: "rate",
      error: `The yearly interest rate must be from 0 to ${MAX_RATE} percent.`,
    };
  }
  if (!Number.isInteger(years) || years < 1 || years > MAX_YEARS) {
    return {
      ok: false,
      field: "years",
      error: `The number of years must be a whole number from 1 to ${MAX_YEARS}.`,
    };
  }
  if (deposit < 0 || deposit > MAX_AMOUNT) {
    return {
      ok: false,
      field: "deposit",
      error: "The regular deposit must be from 0 to 1,000,000,000,000.",
    };
  }
  if (principal === 0 && deposit === 0) {
    return {
      ok: false,
      field: "principal",
      error: "Enter a starting amount or a regular deposit that is more than 0.",
    };
  }

  const perYear = Number(input.frequency);
  const i = rate / 100 / perYear;
  const rows: YearRow[] = [];
  let balance = principal;
  for (let year = 1; year <= years; year += 1) {
    const start = balance;
    let interest = 0;
    for (let period = 0; period < perYear; period += 1) {
      const earned = balance * i;
      interest += earned;
      balance += earned + deposit;
    }
    rows.push({ year, start, deposits: deposit * perYear, interest, end: balance });
    if (balance > MAX_BALANCE) {
      return {
        ok: false,
        field: "years",
        error:
          "The balance would pass 1,000,000,000,000,000, which is too large to show accurately. Lower the amount, the rate or the number of years.",
      };
    }
  }
  const contributed = principal + deposit * perYear * years;
  return {
    ok: true,
    endBalance: balance,
    contributed,
    interest: balance - contributed,
    years: rows,
  };
}
