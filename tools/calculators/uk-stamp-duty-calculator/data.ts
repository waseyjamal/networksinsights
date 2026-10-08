// The official figures of UK Stamp Duty Calculator, in one place: Stamp Duty Land Tax on
// residential property in England and Northern Ireland, as gov.uk publishes them. Each figure was
// read on the source named next to it. Change them only from those sources, and update REVIEWED.

/** The date the rates below take effect, as gov.uk states it. */
export const EFFECTIVE = "1 April 2025";

/** The date we read the sources below. */
export const REVIEWED = "8 October 2026";

/** The official pages the figures come from, shown on the page. */
export const SOURCES = [
  {
    name: "Stamp Duty Land Tax: residential property rates, gov.uk",
    url: "https://www.gov.uk/stamp-duty-land-tax/residential-property-rates",
  },
  {
    name: "Stamp Duty Land Tax: buying an additional residential property, gov.uk",
    url: "https://www.gov.uk/guidance/stamp-duty-land-tax-buying-an-additional-residential-property",
  },
  {
    name: "Stamp Duty Land Tax: reliefs and exemptions, gov.uk",
    url: "https://www.gov.uk/stamp-duty-land-tax/reliefs-and-exemptions",
  },
] as const;

/** A band: the price above `from` pounds, up to the next band, at `rate` percent. */
export interface Band {
  from: number;
  rate: number;
}

/** "Rates for a single property": up to £125,000 zero, then 2%, 5%, 10% and 12%. */
export const STANDARD_BANDS: readonly Band[] = [
  { from: 0, rate: 0 },
  { from: 125_000, rate: 2 },
  { from: 250_000, rate: 5 },
  { from: 925_000, rate: 10 },
  { from: 1_500_000, rate: 12 },
];

/** First-time buyers: no SDLT up to £300,000 and 5% from £300,001 to £500,000. */
export const FIRST_TIME_BANDS: readonly Band[] = [
  { from: 0, rate: 0 },
  { from: 300_000, rate: 5 },
];

/** "If the price is over £500,000, you cannot claim the relief." */
export const FIRST_TIME_MAX_PRICE = 500_000;

/** The higher rates for additional properties: 5% on top of every band. */
export const HIGHER_RATES_SURCHARGE = 5;

/** The higher rates apply to a property bought for £40,000 or more. */
export const HIGHER_RATES_MIN_PRICE = 40_000;

/** Buyers who are not UK resident: a 2% surcharge on top of the other rates that apply. */
export const NON_RESIDENT_SURCHARGE = 2;

/** No SDLT and no return on a freehold bought for less than £40,000. */
export const FREEHOLD_EXEMPT_BELOW = 40_000;
