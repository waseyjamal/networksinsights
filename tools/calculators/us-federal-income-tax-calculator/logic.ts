// Pure logic of US Federal Income Tax Calculator: regular federal income tax for tax year 2026
// from the rate schedules in data.ts, bracket by bracket. No DOM, no network and no top-level
// statements (docs/tool-contract.md, "logic.ts: what pure means").
//
// Rounding: amounts are whole dollars and every rate is a whole percent, so dollars × percent is
// a whole number of cents. The tax is exact to the cent and is never rounded.

import { BRACKETS, type Bracket, STANDARD_DEDUCTION, type Status } from "./data";

/** The largest income taken, in dollars: $1 billion. Our own choice. */
export const MAX_DOLLARS = 1_000_000_000;

export type Deduction = "standard" | "itemized" | "none";

export const DEDUCTIONS = {
  standard: "Standard deduction",
  itemized: "Itemized deductions (enter the total)",
  none: "None: the amount above is already taxable income",
} as const;

/** Kept for the manifest's input schema. */
export interface Input {
  income: string;
  status: Status;
  deduction: Deduction;
  itemized: string;
}

export interface BracketRow {
  from: number;
  to: number | null;
  rate: number;
  /** Dollars of taxable income inside the bracket. */
  portion: number;
  /** The tax on that portion, in cents. */
  taxCents: number;
}

export type Field = "income" | "itemized";

export type Result =
  | {
      ok: true;
      income: number;
      deduction: number;
      taxable: number;
      brackets: BracketRow[];
      taxCents: number;
      /** The rate on the next dollar of taxable income. */
      marginalRate: number;
      /** The tax as a share of the income entered, in hundredths of a percent, half up. */
      effectiveBasisPoints: number;
    }
  | { ok: false; field: Field; error: string };

const LIMIT = `$${MAX_DOLLARS.toLocaleString("en-US")}`;

export const MESSAGES = {
  income: `Enter the income in whole dollars, from 0 to ${LIMIT}.`,
  itemized: `Enter your itemized deductions in whole dollars, from 0 to ${LIMIT}.`,
} as const;

/** Whole dollars from text: commas, spaces and a $ sign allowed. Empty is refused. */
export function parseDollars(text: string): number | null {
  const cleaned = text.replace(/[\s,$]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value > MAX_DOLLARS ? null : value;
}

/** Tax bracket by bracket on a taxable income in dollars. */
export function byBrackets(taxable: number, brackets: readonly Bracket[]): BracketRow[] {
  return brackets.map((bracket, index) => {
    const next = brackets[index + 1]?.from ?? null;
    const top = next === null ? taxable : Math.min(taxable, next);
    const portion = Math.max(0, top - bracket.from);
    return {
      from: bracket.from,
      to: next,
      rate: bracket.rate,
      portion,
      taxCents: portion * bracket.rate,
    };
  });
}

/** The tax on a taxable income for a filing status, in cents. */
export function taxCents(taxable: number, status: Status): number {
  return byBrackets(taxable, BRACKETS[status]).reduce((sum, row) => sum + row.taxCents, 0);
}

/** The federal income tax estimate, or the first field that is wrong. */
export function run(input: Input): Result {
  const income = parseDollars(input.income);
  if (income === null) return { ok: false, field: "income", error: MESSAGES.income };
  let deduction = 0;
  if (input.deduction === "standard") deduction = STANDARD_DEDUCTION[input.status];
  if (input.deduction === "itemized") {
    const itemized = parseDollars(input.itemized);
    if (itemized === null) return { ok: false, field: "itemized", error: MESSAGES.itemized };
    deduction = itemized;
  }
  const taxable = Math.max(0, income - deduction);
  const brackets = byBrackets(taxable, BRACKETS[input.status]);
  const total = brackets.reduce((sum, row) => sum + row.taxCents, 0);
  const reached = brackets.filter((row) => row.from === 0 || taxable > row.from);
  const marginalRate = reached[reached.length - 1]?.rate ?? 0;
  // cents / (dollars × 100) as a percent, in basis points: cents × 100 / income, half up.
  const effectiveBasisPoints =
    income === 0 ? 0 : Math.floor((total * 100 * 2 + income) / (income * 2));
  return {
    ok: true,
    income,
    deduction,
    taxable,
    brackets,
    taxCents: total,
    marginalRate,
    effectiveBasisPoints,
  };
}

/** Dollars and cents, such as $5,800.00. */
export function formatCents(cents: number): string {
  const dollars = Math.floor(cents / 100);
  return `$${dollars.toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
}

/** Whole dollars, such as $50,400. */
export function formatDollars(dollars: number): string {
  return `$${dollars.toLocaleString("en-US")}`;
}

/** Basis points as a percent with two decimals, such as 9.67%. */
export function formatBasisPoints(points: number): string {
  return `${Math.floor(points / 100)}.${String(points % 100).padStart(2, "0")}%`;
}
