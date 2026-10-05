// Pure logic of "Income Tax Calculator India": the slabs, standard deduction, rebate, surcharge with
// marginal relief and cess of tax year 2026-27, for both regimes, with no DOM, no network and no
// top-level statements (docs/tool-contract.md, "logic.ts: what pure means"). All money is whole
// paise (integers) until the end, so there is no floating-point noise; results are whole rupees.

/** The tax year these rules are for, and when they were checked on the official sources. */
export const TAX_YEAR = "2026-27";
export const CHECKED = "5 October 2026";

/** The official sources the figures come from, shown on the page. */
export const SOURCES = [
  {
    name: "Finance Bill, 2026: Memorandum, rates of income-tax for tax year 2026-27",
    url: "https://www.indiabudget.gov.in/doc/memo.pdf",
  },
  {
    name: "Finance Bill, 2026, as published on incometax.gov.in",
    url: "https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/Finance_Bill.pdf",
  },
  {
    name: "Income-tax Act, 2025, section 19 (standard deduction), incometaxindia.gov.in",
    url: "https://www.incometaxindia.gov.in/w/section-19-206",
  },
  {
    name: "Income-tax Act, 2025, section 156 (rebate), incometaxindia.gov.in",
    url: "https://www.incometaxindia.gov.in/w/section-156-84",
  },
] as const;

/** The largest income taken, in rupees: ₹1,000 crore. Our own choice. */
export const MAX_RUPEES = 10_000_000_000;

export type Age = "below60" | "60to79" | "80plus";

export const AGES = {
  below60: "Below 60",
  "60to79": "60 to 79",
  "80plus": "80 or older",
} as const;

/** A slab: income above `from` rupees, up to the next slab, at `rate` percent. */
interface Slab {
  from: number;
  rate: number;
}

/** Section 202 of the Income-tax Act, 2025: the default (new) regime, the same at every age. */
export const NEW_SLABS: readonly Slab[] = [
  { from: 0, rate: 0 },
  { from: 400_000, rate: 5 },
  { from: 800_000, rate: 10 },
  { from: 1_200_000, rate: 15 },
  { from: 1_600_000, rate: 20 },
  { from: 2_000_000, rate: 25 },
  { from: 2_400_000, rate: 30 },
];

/** Part I-B of the First Schedule: the old regime, chosen under section 202(4), by age. */
export const OLD_SLABS: Readonly<Record<Age, readonly Slab[]>> = {
  below60: [
    { from: 0, rate: 0 },
    { from: 250_000, rate: 5 },
    { from: 500_000, rate: 20 },
    { from: 1_000_000, rate: 30 },
  ],
  "60to79": [
    { from: 0, rate: 0 },
    { from: 300_000, rate: 5 },
    { from: 500_000, rate: 20 },
    { from: 1_000_000, rate: 30 },
  ],
  "80plus": [
    { from: 0, rate: 0 },
    { from: 500_000, rate: 20 },
    { from: 1_000_000, rate: 30 },
  ],
};

/** Section 19: the standard deduction on salary, or the salary if it is less. */
export const STANDARD_DEDUCTION = { new: 75_000, old: 50_000 } as const;

/** Section 156: the rebate, up to an amount, when total income is at most a limit. */
export const REBATE = {
  new: { limit: 1_200_000, max: 60_000 },
  old: { limit: 500_000, max: 12_500 },
} as const;

/** Surcharge on income-tax, by total income. The new regime stops at 25%; the old adds 37%. */
export const SURCHARGE = {
  new: [
    { above: 5_000_000, rate: 10 },
    { above: 10_000_000, rate: 15 },
    { above: 20_000_000, rate: 25 },
  ],
  old: [
    { above: 5_000_000, rate: 10 },
    { above: 10_000_000, rate: 15 },
    { above: 20_000_000, rate: 25 },
    { above: 50_000_000, rate: 37 },
  ],
} as const;

/** Health and Education Cess: 4% of income-tax plus surcharge. */
export const CESS_RATE = 4;

export type Regime = "new" | "old";

/** Kept for the manifest's input schema. */
export interface Input {
  salary: string;
  other: string;
  deductions: string;
  age: Age;
}

export interface RegimeResult {
  regime: Regime;
  gross: number;
  standardDeduction: number;
  deductions: number;
  taxable: number;
  slabTax: number;
  rebate: number;
  surcharge: number;
  cess: number;
  total: number;
}

export type Field = "salary" | "other" | "deductions";

export type Result =
  | { ok: true; new: RegimeResult; old: RegimeResult; lower: Regime | "same" }
  | { ok: false; field: Field; error: string };

export const MESSAGES = {
  amount: (label: string) =>
    `Enter ${label} in whole rupees, from 0 to ₹${MAX_RUPEES.toLocaleString("en-IN")}.`,
  total: `Salary and other income together can be at most ₹${MAX_RUPEES.toLocaleString("en-IN")}.`,
} as const;

/** Whole rupees from text: commas, spaces and a ₹ sign allowed; empty is 0. */
export function parseRupees(text: string): number | undefined {
  const cleaned = text.replace(/[\s,₹]/g, "");
  if (cleaned === "") return 0;
  if (!/^\d+$/.test(cleaned)) return;
  const value = Number(cleaned);
  if (value > MAX_RUPEES) return;
  return value;
}

/** Tax on an income by slabs, in paise: rupees × percent is paise, so it is exact. */
export function slabTaxPaise(income: number, slabs: readonly Slab[]): number {
  let paise = 0;
  for (const [index, slab] of slabs.entries()) {
    const next = slabs[index + 1]?.from ?? Number.POSITIVE_INFINITY;
    if (income <= slab.from) break;
    paise += (Math.min(income, next) - slab.from) * slab.rate;
  }
  return paise;
}

/** A percentage of paise, rounded half up to whole paise. */
function percentOf(paise: number, rate: number): number {
  return Math.floor((paise * rate + 50) / 100);
}

/** The surcharge rate at a total income. */
function surchargeRate(income: number, regime: Regime): number {
  let rate = 0;
  for (const band of SURCHARGE[regime]) if (income > band.above) rate = band.rate;
  return rate;
}

/**
 * The surcharge in paise, with marginal relief: income-tax plus surcharge may not exceed the tax
 * plus surcharge at the band's lower edge by more than the income above that edge.
 */
export function surchargePaise(
  income: number,
  taxPaise: number,
  regime: Regime,
  slabs: readonly Slab[],
): number {
  const rate = surchargeRate(income, regime);
  if (rate === 0) return 0;
  let surcharge = percentOf(taxPaise, rate);
  const edge = [...SURCHARGE[regime]].reverse().find((band) => income > band.above)?.above ?? 0;
  const atEdgeTax = slabTaxPaise(edge, slabs);
  const atEdge = atEdgeTax + percentOf(atEdgeTax, surchargeRate(edge, regime));
  const cap = atEdge + (income - edge) * 100;
  if (taxPaise + surcharge > cap) surcharge = Math.max(0, cap - taxPaise);
  return surcharge;
}

/**
 * The rebate in paise. Up to the limit, the tax up to its maximum. In the new regime, just above
 * the limit, marginal relief keeps the tax from exceeding the income above the limit.
 */
export function rebatePaise(income: number, taxPaise: number, regime: Regime): number {
  const rule = REBATE[regime];
  if (income <= rule.limit) return Math.min(taxPaise, rule.max * 100);
  if (regime === "new") {
    const excess = (income - rule.limit) * 100;
    if (taxPaise > excess) return taxPaise - excess;
  }
  return 0;
}

const rupees = (paise: number) => Math.floor((paise + 50) / 100);

/** One regime's tax, from salary, other income and (old regime only) deductions, in rupees. */
export function computeRegime(
  regime: Regime,
  salary: number,
  other: number,
  deductions: number,
  age: Age,
): RegimeResult {
  const gross = salary + other;
  const standardDeduction = Math.min(salary, STANDARD_DEDUCTION[regime]);
  const claimed = regime === "old" ? Math.min(deductions, gross - standardDeduction) : 0;
  const taxable = Math.max(0, gross - standardDeduction - claimed);
  const slabs = regime === "new" ? NEW_SLABS : OLD_SLABS[age];
  const slabTax = slabTaxPaise(taxable, slabs);
  const rebate = rebatePaise(taxable, slabTax, regime);
  const afterRebate = slabTax - rebate;
  const surcharge = afterRebate > 0 ? surchargePaise(taxable, afterRebate, regime, slabs) : 0;
  const cess = percentOf(afterRebate + surcharge, CESS_RATE);
  return {
    regime,
    gross,
    standardDeduction,
    deductions: claimed,
    taxable,
    slabTax: rupees(slabTax),
    rebate: rupees(rebate),
    surcharge: rupees(surcharge),
    cess: rupees(cess),
    total: rupees(afterRebate + surcharge + cess),
  };
}

/** Both regimes side by side, or the first field that is wrong. */
export function run(input: Input): Result {
  const labels: Record<Field, string> = {
    salary: "the salary",
    other: "the other income",
    deductions: "the deductions",
  };
  const values: Partial<Record<Field, number>> = {};
  for (const field of ["salary", "other", "deductions"] as const) {
    const value = parseRupees(input[field]);
    if (typeof value === "undefined") {
      return { ok: false, field, error: MESSAGES.amount(labels[field]) };
    }
    values[field] = value;
  }
  const salary = values.salary ?? 0;
  const other = values.other ?? 0;
  if (salary + other > MAX_RUPEES) return { ok: false, field: "other", error: MESSAGES.total };
  const deductions = values.deductions ?? 0;
  const regimeNew = computeRegime("new", salary, other, deductions, input.age);
  const regimeOld = computeRegime("old", salary, other, deductions, input.age);
  const lower =
    regimeNew.total === regimeOld.total
      ? "same"
      : regimeNew.total < regimeOld.total
        ? "new"
        : "old";
  return { ok: true, new: regimeNew, old: regimeOld, lower };
}

/** Rupees in the Indian grouping, such as ₹12,75,000. */
export function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN")}`;
}
