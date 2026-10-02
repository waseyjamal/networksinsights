// Pure logic of EMI Calculator: the equated monthly instalment of a loan on the reducing-balance
// method, and the month-by-month schedule. Interest is charged each month on the balance left,
// at one twelfth of the yearly rate. Figures are held at full precision and rounded only to show.

export type Unit = "years" | "months";

/** The largest loan amount, the highest yearly rate and the longest tenure the tool accepts. */
export const MAX_AMOUNT = 1e12;
export const MAX_RATE = 100;
export const MAX_MONTHS = 600;

/** What the tool accepts, as typed. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  amount: string;
  /** Yearly interest rate in percent. */
  rate: string;
  tenure: string;
  unit: Unit;
}

export interface ScheduleRow {
  month: number;
  /** The instalment paid this month. */
  payment: number;
  /** The part of it that repays the loan. */
  principal: number;
  /** The part of it that is interest. */
  interest: number;
  /** What is still owed after this payment. */
  balance: number;
}

export type Field = "amount" | "rate" | "tenure";

export type Result =
  | {
      ok: true;
      months: number;
      emi: number;
      totalInterest: number;
      totalPayment: number;
      schedule: ScheduleRow[];
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
  amount: "the loan amount",
  rate: "the yearly interest rate",
  tenure: "the tenure",
};

function read(text: string, field: Field): number | Result {
  if (text.trim() === "") {
    return { ok: false, field, error: `Enter ${NAMES[field]}.` };
  }
  const value = parseNumber(text);
  if (value === null) {
    return {
      ok: false,
      field,
      error: `${NAMES[field].replace(/^./, (c) => c.toUpperCase())} is not a number. Use digits, with a decimal point if needed, such as 8.5.`,
    };
  }
  return value;
}

/** The monthly instalment for `amount` over `months` at a monthly rate `r` (0.01 is 1%). */
export function monthlyPayment(amount: number, r: number, months: number): number {
  if (r === 0) return amount / months;
  return (amount * r) / (1 - (1 + r) ** -months);
}

/** The instalment, the totals and the schedule of a loan, or what is wrong with the inputs. */
export function run(input: Input): Result {
  const amount = read(input.amount, "amount");
  if (typeof amount !== "number") return amount;
  const rate = read(input.rate, "rate");
  if (typeof rate !== "number") return rate;
  const tenure = read(input.tenure, "tenure");
  if (typeof tenure !== "number") return tenure;

  if (amount <= 0) {
    return { ok: false, field: "amount", error: "The loan amount must be more than 0." };
  }
  if (amount > MAX_AMOUNT) {
    return {
      ok: false,
      field: "amount",
      error: "The loan amount is too large; the limit is 1,000,000,000,000.",
    };
  }
  if (rate < 0 || rate > MAX_RATE) {
    return {
      ok: false,
      field: "rate",
      error: `The yearly interest rate must be from 0 to ${MAX_RATE} percent.`,
    };
  }
  if (tenure <= 0) {
    return { ok: false, field: "tenure", error: "The tenure must be more than 0." };
  }
  const exact = input.unit === "years" ? tenure * 12 : tenure;
  const months = Math.round(exact);
  if (Math.abs(exact - months) > 1e-9) {
    return {
      ok: false,
      field: "tenure",
      error: "The tenure must come to a whole number of months, such as 2.5 years or 30 months.",
    };
  }
  if (months < 1 || months > MAX_MONTHS) {
    return {
      ok: false,
      field: "tenure",
      error: `The tenure must be from 1 month to ${MAX_MONTHS} months (${MAX_MONTHS / 12} years).`,
    };
  }

  const r = rate / 12 / 100;
  const emi = monthlyPayment(amount, r, months);
  const schedule: ScheduleRow[] = [];
  let balance = amount;
  for (let month = 1; month <= months; month += 1) {
    const interest = balance * r;
    const principal = emi - interest;
    balance = month === months ? 0 : balance - principal;
    schedule.push({ month, payment: emi, principal, interest, balance });
  }
  const totalPayment = emi * months;
  return { ok: true, months, emi, totalInterest: totalPayment - amount, totalPayment, schedule };
}
