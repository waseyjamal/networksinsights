// The official figures of Canada Mortgage Payment Calculator, in one place: CMHC's minimum down
// payment and mortgage loan insurance premiums, and the Interest Act rule on how a mortgage rate
// is stated. Change them only from these sources, and update REVIEWED.

/** The date we read the sources below. CMHC's pages give no effective date for the figures. */
export const REVIEWED = "8 October 2026";

/** The official pages the figures come from, shown on the page. */
export const SOURCES = [
  {
    name: "CMHC mortgage loan insurance costs (premium table), cmhc-schl.gc.ca",
    url: "https://www.cmhc-schl.gc.ca/consumers/home-buying/mortgage-loan-insurance-for-consumers/cmhc-mortgage-loan-insurance-cost",
  },
  {
    name: "What is mortgage loan insurance (minimum down payment), cmhc-schl.gc.ca",
    url: "https://www.cmhc-schl.gc.ca/consumers/home-buying/mortgage-loan-insurance-for-consumers/what-is-mortgage-loan-insurance",
  },
  {
    name: "Interest Act, section 6, Justice Laws Website",
    url: "https://laws-lois.justice.gc.ca/eng/acts/i-15/page-1.html",
  },
] as const;

/**
 * Interest Act, s. 6: a blended-payment mortgage must state its rate "calculated yearly or
 * half-yearly, not in advance". This tool treats the rate as compounded half-yearly.
 */
export const COMPOUNDS_PER_YEAR = 2;

/** "You'll need mortgage loan insurance" with a down payment of less than 20%. */
export const INSURANCE_BELOW_DOWN_PERCENT = 20;

/** 5% down on the first $500,000 and 10% on the remainder. */
export const MIN_DOWN = { firstPart: 500_000, firstRate: 5, restRate: 10 } as const;

/** "If the home costs $1,500,000 or more, mortgage loan insurance is not available." */
export const INSURANCE_MAX_PRICE = 1_500_000;

/**
 * The premium on the total loan, by loan-to-value: LTV up to and including `upTo` hundredths of
 * a percent, at `premium` hundredths of a percent. Traditional down payment, no portability.
 */
export const PREMIUMS: ReadonlyArray<{ upTo: number; premium: number }> = [
  { upTo: 6_500, premium: 60 },
  { upTo: 7_500, premium: 170 },
  { upTo: 8_000, premium: 240 },
  { upTo: 8_500, premium: 280 },
  { upTo: 9_000, premium: 310 },
  { upTo: 9_500, premium: 400 },
];
