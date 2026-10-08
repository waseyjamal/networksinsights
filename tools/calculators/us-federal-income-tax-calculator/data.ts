// The official figures of US Federal Income Tax Calculator, in one place: the tax rate schedules
// and standard deductions for tax year 2026, from Revenue Procedure 2025-32 (sections 3.01 and
// 3.14) and the IRS announcement of it. Change them only from those sources, and update REVIEWED.

/** The tax year these figures are for: returns filed in 2027. */
export const TAX_YEAR = 2026;

/** The date we read the sources below. */
export const REVIEWED = "8 October 2026";

/** The official pages the figures come from, shown on the page. */
export const SOURCES = [
  {
    name: "Revenue Procedure 2025-32, tax rate tables and standard deduction for 2026, irs.gov",
    url: "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf",
  },
  {
    name: "IRS releases tax inflation adjustments for tax year 2026 (IR-2025-103), irs.gov",
    url: "https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill",
  },
] as const;

export type Status = "single" | "joint" | "separate" | "head";

export const STATUSES = {
  single: "Single",
  joint: "Married filing jointly, or qualifying surviving spouse",
  separate: "Married filing separately",
  head: "Head of household",
} as const;

/** A bracket: taxable income over `from` dollars, up to the next bracket, at `rate` percent. */
export interface Bracket {
  from: number;
  rate: number;
}

/** Rev. Proc. 2025-32, section 3.01, Tables 1 to 4: the rate schedules for 2026. */
export const BRACKETS: Readonly<Record<Status, readonly Bracket[]>> = {
  joint: [
    { from: 0, rate: 10 },
    { from: 24_800, rate: 12 },
    { from: 100_800, rate: 22 },
    { from: 211_400, rate: 24 },
    { from: 403_550, rate: 32 },
    { from: 512_450, rate: 35 },
    { from: 768_700, rate: 37 },
  ],
  head: [
    { from: 0, rate: 10 },
    { from: 17_700, rate: 12 },
    { from: 67_450, rate: 22 },
    { from: 105_700, rate: 24 },
    { from: 201_750, rate: 32 },
    { from: 256_200, rate: 35 },
    { from: 640_600, rate: 37 },
  ],
  single: [
    { from: 0, rate: 10 },
    { from: 12_400, rate: 12 },
    { from: 50_400, rate: 22 },
    { from: 105_700, rate: 24 },
    { from: 201_775, rate: 32 },
    { from: 256_225, rate: 35 },
    { from: 640_600, rate: 37 },
  ],
  separate: [
    { from: 0, rate: 10 },
    { from: 12_400, rate: 12 },
    { from: 50_400, rate: 22 },
    { from: 105_700, rate: 24 },
    { from: 201_775, rate: 32 },
    { from: 256_225, rate: 35 },
    { from: 384_350, rate: 37 },
  ],
};

/** Rev. Proc. 2025-32, section 3.14(1): the basic standard deduction for 2026, in dollars. */
export const STANDARD_DEDUCTION: Readonly<Record<Status, number>> = {
  joint: 32_200,
  head: 24_150,
  single: 16_100,
  separate: 16_100,
};
