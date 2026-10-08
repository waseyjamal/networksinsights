// Pure logic of Canada Mortgage Payment Calculator: the payment of a fixed-rate mortgage whose
// rate is compounded half-yearly, CMHC's minimum down payment and its mortgage loan insurance
// premium, and a year-by-year summary. No DOM, no network and no top-level statements
// (docs/tool-contract.md, "logic.ts: what pure means").
//
// Compounding: the yearly rate j is compounded twice a year, so the rate for one of m payments a
// year is (1 + j/2)^(2/m) − 1. Variable-rate mortgages are not handled.
//
// Rounding rule: all money is whole cents. The premium is rounded half up to the cent. The
// payment and each period's interest are rounded to the nearest cent; the last payment is
// whatever clears the balance, so the payments add up to the mortgage plus the interest exactly.

import {
  COMPOUNDS_PER_YEAR,
  INSURANCE_BELOW_DOWN_PERCENT,
  INSURANCE_MAX_PRICE,
  MIN_DOWN,
  PREMIUMS,
} from "./data";

/** The highest price, the highest rate and the longest amortization taken: our own choices. */
export const MAX_DOLLARS = 50_000_000;
export const MAX_RATE = 30;
export const MAX_YEARS = 40;

export type Frequency = "monthly" | "semi-monthly" | "bi-weekly" | "weekly";

export const FREQUENCIES: Readonly<Record<Frequency, { label: string; perYear: number }>> = {
  monthly: { label: "Monthly (12 a year)", perYear: 12 },
  "semi-monthly": { label: "Semi-monthly (24 a year)", perYear: 24 },
  "bi-weekly": { label: "Bi-weekly (26 a year)", perYear: 26 },
  weekly: { label: "Weekly (52 a year)", perYear: 52 },
};

export type PremiumPaid = "added" | "separate";

/** Kept for the manifest's input schema. */
export interface Input {
  price: string;
  down: string;
  /** Yearly rate in percent, compounded half-yearly, up to three decimals. */
  rate: string;
  years: string;
  frequency: Frequency;
  premiumPaid: PremiumPaid;
}

export type Field = "price" | "down" | "rate" | "years";

export interface YearRow {
  year: number;
  paid: number;
  principal: number;
  interest: number;
  balance: number;
}

export interface Mortgage {
  loan: number;
  minimumDown: number;
  insured: boolean;
  /** Loan to value in hundredths of a percent, rounded half up (display only). */
  ltvBasisPoints: number;
  /** The premium rate in hundredths of a percent; 0 when not insured. */
  premiumRate: number;
  premium: number;
  /** The amount borrowed: the loan, plus the premium when it is added. */
  mortgage: number;
  payment: number;
  payments: number;
  totalInterest: number;
  totalPaid: number;
  years: YearRow[];
}

export type Result = ({ ok: true } & Mortgage) | { ok: false; field: Field; error: string };

const LIMIT = `$${MAX_DOLLARS.toLocaleString("en-CA")}`;

export const MESSAGES = {
  price: `Enter the home price in dollars, more than 0 and up to ${LIMIT}.`,
  down: `Enter the down payment in dollars, with at most two decimals.`,
  downTooBig: "The down payment must be less than the home price.",
  minimum: (cents: number) =>
    `The minimum down payment on this price is ${formatCents(cents)}: 5% of the first $500,000 and 10% of the rest.`,
  uninsurable:
    "Mortgage loan insurance is not available on a home of $1,500,000 or more, so the down payment must be at least 20%.",
  rate: `Enter the interest rate as a percent from 0 to ${MAX_RATE}, with at most three decimals.`,
  years: `Enter the amortization as whole years, from 1 to ${MAX_YEARS}.`,
} as const;

/** Cents from dollars as typed: commas, spaces and a $ sign allowed, two decimals at most. */
export function parseCents(text: string): number | null {
  const cleaned = text.replace(/[\s,$]/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return cents > MAX_DOLLARS * 100 ? null : cents;
}

/** A yearly rate in thousandths of a percent: "5.25" is 5250. Up to three decimals. */
export function parseRate(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text.trim().replace(/%$/, ""));
  if (!match) return null;
  const milli = Number(match[1]) * 1000 + Number((match[2] ?? "").padEnd(3, "0"));
  return milli > MAX_RATE * 1000 ? null : milli;
}

/** CMHC's minimum down payment in cents: 5% of the first $500,000, 10% of the rest, rounded up. */
export function minimumDown(price: number): number {
  const first = Math.min(price, MIN_DOWN.firstPart * 100);
  const rest = price - first;
  return Math.ceil((first * MIN_DOWN.firstRate + rest * MIN_DOWN.restRate) / 100);
}

/** The CMHC premium rate for a loan and price, in hundredths of a percent. */
export function premiumRate(loan: number, price: number): number {
  // loan / price ≤ upTo / 10,000, compared in whole numbers.
  return PREMIUMS.find((band) => loan * 10_000 <= price * band.upTo)?.premium ?? 0;
}

/** The rate for one period, from a yearly rate compounded half-yearly. */
export function periodicRate(rateMilli: number, perYear: number): number {
  const half = rateMilli / 100_000 / COMPOUNDS_PER_YEAR;
  return (1 + half) ** (COMPOUNDS_PER_YEAR / perYear) - 1;
}

/** The level payment in cents, rounded to the nearest cent. */
export function levelPayment(mortgage: number, rate: number, periods: number): number {
  if (rate === 0) return Math.floor((mortgage * 2 + periods) / (periods * 2));
  return Math.round((mortgage * rate) / (1 - (1 + rate) ** -periods));
}

/** The payments period by period, summed year by year. */
export function amortize(mortgage: number, rate: number, perYear: number, years: number) {
  const periods = perYear * years;
  const payment = levelPayment(mortgage, rate, periods);
  const rows: YearRow[] = [];
  let balance = mortgage;
  let count = 0;
  for (let period = 1; period <= periods && balance > 0; period += 1) {
    const interest = Math.round(balance * rate);
    let principal = payment - interest;
    if (principal >= balance || period === periods) principal = balance;
    balance -= principal;
    count = period;
    const year = Math.ceil(period / perYear);
    let row = rows[year - 1];
    if (!row) {
      row = { year, paid: 0, principal: 0, interest: 0, balance: 0 };
      rows.push(row);
    }
    row.paid += principal + interest;
    row.principal += principal;
    row.interest += interest;
    row.balance = balance;
  }
  return { payment, payments: count, rows };
}

/** The mortgage, or the first field that is wrong. */
export function run(input: Input): Result {
  const price = parseCents(input.price);
  if (price === null || price === 0) return { ok: false, field: "price", error: MESSAGES.price };
  const down = parseCents(input.down);
  if (down === null) return { ok: false, field: "down", error: MESSAGES.down };
  if (down >= price) return { ok: false, field: "down", error: MESSAGES.downTooBig };
  const minimum = minimumDown(price);
  if (down < minimum) return { ok: false, field: "down", error: MESSAGES.minimum(minimum) };
  const insured = down * 100 < price * INSURANCE_BELOW_DOWN_PERCENT;
  if (insured && price >= INSURANCE_MAX_PRICE * 100) {
    return { ok: false, field: "down", error: MESSAGES.uninsurable };
  }
  const rateMilli = parseRate(input.rate);
  if (rateMilli === null) return { ok: false, field: "rate", error: MESSAGES.rate };
  const yearsText = input.years.trim();
  const years = /^\d+$/.test(yearsText) ? Number(yearsText) : 0;
  if (years < 1 || years > MAX_YEARS) return { ok: false, field: "years", error: MESSAGES.years };

  const loan = price - down;
  const rate = insured ? premiumRate(loan, price) : 0;
  const premium = Math.floor((loan * rate * 2 + 10_000) / 20_000);
  const mortgage = input.premiumPaid === "added" ? loan + premium : loan;
  const perYear = FREQUENCIES[input.frequency].perYear;
  const plan = amortize(mortgage, periodicRate(rateMilli, perYear), perYear, years);
  const totalInterest = plan.rows.reduce((sum, row) => sum + row.interest, 0);
  return {
    ok: true,
    loan,
    minimumDown: minimum,
    insured,
    ltvBasisPoints: Math.floor((loan * 10_000 * 2 + price) / (price * 2)),
    premiumRate: rate,
    premium,
    mortgage,
    payment: plan.payment,
    payments: plan.payments,
    totalInterest,
    totalPaid: plan.rows.reduce((sum, row) => sum + row.paid, 0),
    years: plan.rows,
  };
}

/** Dollars and cents, such as $639.81. */
export function formatCents(cents: number): string {
  const dollars = Math.floor(cents / 100);
  return `$${dollars.toLocaleString("en-CA")}.${String(cents % 100).padStart(2, "0")}`;
}

/** Hundredths of a percent with two decimals, such as 95.00%. */
export function formatBasisPoints(points: number): string {
  return `${Math.floor(points / 100)}.${String(points % 100).padStart(2, "0")}%`;
}
