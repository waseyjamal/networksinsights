// Pure logic of US Mortgage Calculator: the monthly principal and interest of a fixed-rate loan,
// the monthly property tax, insurance and PMI the visitor enters, extra monthly payments and the
// month-by-month amortization table. No DOM, no network and no top-level statements
// (docs/tool-contract.md, "logic.ts: what pure means").
//
// Rounding rule: all money is whole cents. Interest is charged each month at one twelfth of the
// yearly rate on the balance, rounded half up to the cent (BigInt, so it is exact at any size).
// The principal and interest payment is the standard formula rounded half up to the cent. The
// last payment is whatever clears the balance, so the payments always add up to the loan plus the
// interest, to the cent. PMI is not worked out: the visitor enters what the lender quotes.

/** The highest price taken, the highest rate and the longest term: our own choices. */
export const MAX_DOLLARS = 100_000_000;
export const MAX_RATE = 30;
export const MAX_YEARS = 40;

/** Kept for the manifest's input schema. */
export interface Input {
  price: string;
  down: string;
  /** Yearly interest rate in percent, up to three decimals. */
  rate: string;
  years: string;
  /** Property tax for a year. */
  tax: string;
  /** Homeowners insurance for a year. */
  insurance: string;
  /** PMI for a month, as the lender quotes it. */
  pmi: string;
  /** An extra payment toward principal every month. */
  extra: string;
}

export type Field = keyof Input;

export interface Row {
  month: number;
  interest: number;
  /** Principal repaid this month, extra payment included. */
  principal: number;
  /** Principal and interest paid this month, extra payment included. */
  paid: number;
  balance: number;
}

export interface Mortgage {
  loan: number;
  principalAndInterest: number;
  monthlyTax: number;
  monthlyInsurance: number;
  pmi: number;
  /** Principal and interest, tax, insurance and PMI: what is due each month, without extra. */
  monthlyTotal: number;
  extra: number;
  payments: number;
  totalInterest: number;
  /** Every principal and interest payment added up, extra payments included. */
  totalPaid: number;
  schedule: Row[];
}

export type Result = ({ ok: true } & Mortgage) | { ok: false; field: Field; error: string };

const LIMIT = `$${MAX_DOLLARS.toLocaleString("en-US")}`;

export const MESSAGES = {
  money: (label: string) =>
    `Enter ${label} in dollars, with at most two decimals, from 0 to ${LIMIT}.`,
  price: `Enter the home price in dollars, more than 0 and up to ${LIMIT}.`,
  down: "The down payment must be less than the home price.",
  rate: `Enter the interest rate as a percent from 0 to ${MAX_RATE}, with at most three decimals.`,
  years: `Enter the term as whole years, from 1 to ${MAX_YEARS}.`,
} as const;

/** Cents from dollars as typed: commas, spaces and a $ sign allowed, two decimals at most. */
export function parseCents(text: string): number | null {
  const cleaned = text.replace(/[\s,$]/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return cents > MAX_DOLLARS * 100 ? null : cents;
}

/** A yearly rate in thousandths of a percent: "6.5" is 6500. Up to three decimals. */
export function parseRate(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text.trim().replace(/%$/, ""));
  if (!match) return null;
  const milli = Number(match[1]) * 1000 + Number((match[2] ?? "").padEnd(3, "0"));
  return milli > MAX_RATE * 1000 ? null : milli;
}

/** A month's interest in cents on a balance, at a yearly rate in thousandths of a percent. */
export function monthlyInterest(balance: number, rateMilli: number): number {
  // balance × (rate / 100 / 12), with the rate in thousandths: divide by 1,200,000. Half up.
  const denominator = 1_200_000n;
  const doubled = 2n * BigInt(balance) * BigInt(rateMilli) + denominator;
  return Number(doubled / (2n * denominator));
}

/** The monthly principal and interest in cents: the standard formula, rounded half up. */
export function monthlyPayment(loan: number, rateMilli: number, months: number): number {
  if (rateMilli === 0) return Math.floor((loan * 2 + months) / (months * 2));
  const r = rateMilli / 1_200_000;
  return Math.round((loan * r) / (1 - (1 + r) ** -months));
}

/** The amortization table: one row a month until the balance is nil. */
export function amortize(loan: number, rateMilli: number, months: number, extra: number): Row[] {
  const payment = monthlyPayment(loan, rateMilli, months);
  const rows: Row[] = [];
  let balance = loan;
  for (let month = 1; balance > 0 && month <= months; month += 1) {
    const interest = monthlyInterest(balance, rateMilli);
    let principal = payment - interest + extra;
    if (principal >= balance || month === months) principal = balance;
    balance -= principal;
    rows.push({ month, interest, principal, paid: principal + interest, balance });
  }
  return rows;
}

/** The amortization table summed year by year: the balance is the one after the year's last month. */
export function byYear(schedule: readonly Row[]): Row[] {
  const years: Row[] = [];
  for (const row of schedule) {
    const year = Math.ceil(row.month / 12);
    let sum = years[year - 1];
    if (!sum) {
      sum = { month: year, interest: 0, principal: 0, paid: 0, balance: 0 };
      years.push(sum);
    }
    sum.interest += row.interest;
    sum.principal += row.principal;
    sum.paid += row.paid;
    sum.balance = row.balance;
  }
  return years;
}

/** Half up division of cents by a whole number. */
const share = (cents: number, by: number) => Math.floor((cents * 2 + by) / (by * 2));

const NAMES: Record<"tax" | "insurance" | "pmi" | "extra", string> = {
  tax: "the property tax for a year",
  insurance: "the insurance for a year",
  pmi: "the PMI for a month",
  extra: "the extra payment for a month",
};

/** The mortgage, or the first field that is wrong. */
export function run(input: Input): Result {
  const price = parseCents(input.price);
  if (price === null || price === 0) return { ok: false, field: "price", error: MESSAGES.price };
  const down = parseCents(input.down);
  if (down === null) {
    return { ok: false, field: "down", error: MESSAGES.money("the down payment") };
  }
  if (down >= price) return { ok: false, field: "down", error: MESSAGES.down };
  const rateMilli = parseRate(input.rate);
  if (rateMilli === null) return { ok: false, field: "rate", error: MESSAGES.rate };
  const yearsText = input.years.trim();
  const years = /^\d+$/.test(yearsText) ? Number(yearsText) : 0;
  if (years < 1 || years > MAX_YEARS) return { ok: false, field: "years", error: MESSAGES.years };
  const costs: Record<"tax" | "insurance" | "pmi" | "extra", number> = {
    tax: 0,
    insurance: 0,
    pmi: 0,
    extra: 0,
  };
  for (const field of ["tax", "insurance", "pmi", "extra"] as const) {
    const text = input[field].trim();
    const value = text === "" ? 0 : parseCents(text);
    if (value === null) return { ok: false, field, error: MESSAGES.money(NAMES[field]) };
    costs[field] = value;
  }

  const loan = price - down;
  const months = years * 12;
  const principalAndInterest = monthlyPayment(loan, rateMilli, months);
  const schedule = amortize(loan, rateMilli, months, costs.extra);
  const monthlyTax = share(costs.tax, 12);
  const monthlyInsurance = share(costs.insurance, 12);
  return {
    ok: true,
    loan,
    principalAndInterest,
    monthlyTax,
    monthlyInsurance,
    pmi: costs.pmi,
    monthlyTotal: principalAndInterest + monthlyTax + monthlyInsurance + costs.pmi,
    extra: costs.extra,
    payments: schedule.length,
    totalInterest: schedule.reduce((sum, row) => sum + row.interest, 0),
    totalPaid: schedule.reduce((sum, row) => sum + row.paid, 0),
    schedule,
  };
}

/** Dollars and cents, such as $1,199.10. */
export function formatCents(cents: number): string {
  const dollars = Math.floor(cents / 100);
  return `$${dollars.toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
}

/** A number of months as years and months, such as "30 years" or "24 years 7 months". */
export function formatMonths(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (rest > 0) parts.push(`${rest} ${rest === 1 ? "month" : "months"}`);
  return parts.join(" ");
}
