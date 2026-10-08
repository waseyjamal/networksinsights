// Pure logic of UK Stamp Duty Calculator: Stamp Duty Land Tax on a residential purchase in
// England or Northern Ireland, band by band, from the figures in data.ts. No DOM, no network and
// no top-level statements (docs/tool-contract.md, "logic.ts: what pure means").
//
// Rounding: the price is whole pounds and every rate is a whole percent, so pounds × percent is a
// whole number of pence. The tax is exact in pence and is never rounded.

import {
  type Band,
  FIRST_TIME_BANDS,
  FIRST_TIME_MAX_PRICE,
  FREEHOLD_EXEMPT_BELOW,
  HIGHER_RATES_MIN_PRICE,
  HIGHER_RATES_SURCHARGE,
  NON_RESIDENT_SURCHARGE,
  STANDARD_BANDS,
} from "./data";

/** The highest price taken, in pounds: £1 billion. Our own choice. */
export const MAX_PRICE = 1_000_000_000;

export type Buyer = "home" | "first" | "additional";

export const BUYERS = {
  home: "Moving home, or this will be the only home I own",
  first: "First-time buyer",
  additional: "Buying an additional property (higher rates)",
} as const;

/** Kept for the manifest's input schema. */
export interface Input {
  price: string;
  buyer: Buyer;
  nonResident: boolean;
}

export interface BandRow {
  /** The band runs from `from` pounds up to `to` (null: no upper end). */
  from: number;
  to: number | null;
  rate: number;
  /** Pounds of the price inside the band. */
  portion: number;
  /** The tax on that portion, in pence. */
  taxPence: number;
}

export type Note = "first-time-over-limit" | "exempt-under-40k";

export type Result =
  | {
      ok: true;
      price: number;
      bands: BandRow[];
      totalPence: number;
      /** The tax as a share of the price, in hundredths of a percent, rounded half up. */
      effectiveBasisPoints: number;
      notes: Note[];
    }
  | { ok: false; error: string };

export const MESSAGES = {
  price: `Enter the price in whole pounds, from 1 to £${MAX_PRICE.toLocaleString("en-GB")}.`,
} as const;

/** Whole pounds from text: commas, spaces and a £ sign allowed. Empty or 0 is refused. */
export function parsePounds(text: string): number | null {
  const cleaned = text.replace(/[\s,£]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (value < 1 || value > MAX_PRICE) return null;
  return value;
}

/** The bands, each with `extra` percentage points added. */
function lift(bands: readonly Band[], extra: number): Band[] {
  return bands.map((band) => ({ from: band.from, rate: band.rate + extra }));
}

/** Tax band by band on a price in pounds. */
export function byBands(price: number, bands: readonly Band[]): BandRow[] {
  const rows: BandRow[] = [];
  for (const [index, band] of bands.entries()) {
    const next = bands[index + 1]?.from ?? null;
    const top = next === null ? price : Math.min(price, next);
    const portion = Math.max(0, top - band.from);
    rows.push({
      from: band.from,
      to: next,
      rate: band.rate,
      portion,
      taxPence: portion * band.rate,
    });
  }
  return rows;
}

/** The SDLT on a purchase, or what is wrong with the price. */
export function run(input: Input): Result {
  const price = parsePounds(input.price);
  if (price === null) return { ok: false, error: MESSAGES.price };
  const notes: Note[] = [];
  let bands: Band[] = [...STANDARD_BANDS];
  if (input.buyer === "first") {
    if (price <= FIRST_TIME_MAX_PRICE) bands = [...FIRST_TIME_BANDS];
    else notes.push("first-time-over-limit");
  }
  if (input.buyer === "additional" && price >= HIGHER_RATES_MIN_PRICE) {
    bands = lift(bands, HIGHER_RATES_SURCHARGE);
  }
  if (input.nonResident) bands = lift(bands, NON_RESIDENT_SURCHARGE);
  let rows = byBands(price, bands);
  if (price < FREEHOLD_EXEMPT_BELOW) {
    notes.push("exempt-under-40k");
    rows = rows.map((row) => ({ ...row, taxPence: 0 }));
  }
  const totalPence = rows.reduce((sum, row) => sum + row.taxPence, 0);
  // pence / (pounds × 100) as a percent, in basis points: pence × 100 / price, half up.
  const effectiveBasisPoints = Math.floor((totalPence * 100 * 2 + price) / (price * 2));
  return { ok: true, price, bands: rows, totalPence, effectiveBasisPoints, notes };
}

/** Pounds and pence, such as £4,750 or £4,750.50: pence only when there are some. */
export function formatPence(pence: number): string {
  const pounds = Math.floor(pence / 100);
  const rest = pence % 100;
  const whole = `£${pounds.toLocaleString("en-GB")}`;
  return rest === 0 ? whole : `${whole}.${String(rest).padStart(2, "0")}`;
}

/** Whole pounds, such as £125,000. */
export function formatPounds(pounds: number): string {
  return `£${pounds.toLocaleString("en-GB")}`;
}

/** Basis points as a percent with two decimals, such as 1.61%. */
export function formatBasisPoints(points: number): string {
  return `${Math.floor(points / 100)}.${String(points % 100).padStart(2, "0")}%`;
}
