import { describe, expect, it } from "vitest";
import { formatBasisPoints, formatPence, MAX_PRICE, MESSAGES, run } from "./logic";

type Buyer = "home" | "first" | "additional";

/** The total in pence, or the error. */
function sdlt(price: string, buyer: Buyer = "home", nonResident = false) {
  const result = run({ price, buyer, nonResident });
  return result.ok ? result.totalPence : result.error;
}

const pounds = (value: number) => value * 100;

describe("gov.uk worked examples (rates from 1 April 2025)", () => {
  it("a house for £295,000 owes £4,750", () => {
    expect(sdlt("295,000")).toBe(pounds(4_750));
    const result = run({ price: "295000", buyer: "home", nonResident: false });
    expect(result.ok && result.bands.map((row) => row.taxPence)).toEqual([
      0,
      pounds(2_500),
      pounds(2_250),
      0,
      0,
    ]);
  });

  it("a first-time buyer at £500,000 owes £10,000", () => {
    expect(sdlt("500000", "first")).toBe(pounds(10_000));
  });

  it("an additional property for £300,000 owes £20,000 at the higher rates", () => {
    expect(sdlt("300000", "additional")).toBe(pounds(20_000));
  });

  it("the shared ownership examples: £280,000 owes £4,000 and £260,000 owes £3,000", () => {
    expect(sdlt("280000")).toBe(pounds(4_000));
    expect(sdlt("260000")).toBe(pounds(3_000));
  });
});

describe("band boundaries, one pound either side", () => {
  it("the £125,000 threshold", () => {
    expect(sdlt("124999")).toBe(0);
    expect(sdlt("125000")).toBe(0);
    expect(sdlt("125001")).toBe(2);
  });

  it("the £250,000, £925,000 and £1.5 million edges", () => {
    expect(sdlt("250000")).toBe(pounds(2_500));
    expect(sdlt("250001")).toBe(pounds(2_500) + 5);
    expect(sdlt("925000")).toBe(pounds(36_250));
    expect(sdlt("925001")).toBe(pounds(36_250) + 10);
    expect(sdlt("1500000")).toBe(pounds(93_750));
    expect(sdlt("1500001")).toBe(pounds(93_750) + 12);
  });

  it("first-time buyer relief: nil to £300,000, and none above £500,000", () => {
    expect(sdlt("300000", "first")).toBe(0);
    expect(sdlt("300001", "first")).toBe(5);
    expect(sdlt("499999", "first")).toBe(pounds(10_000) - 5);
    // Over £500,000 the standard rates apply to the whole price.
    expect(sdlt("500001", "first")).toBe(pounds(15_000) + 5);
    const over = run({ price: "500001", buyer: "first", nonResident: false });
    expect(over.ok && over.notes).toEqual(["first-time-over-limit"]);
  });

  it("the higher rates start at £40,000, and nothing is due on a freehold below it", () => {
    expect(sdlt("39999", "additional")).toBe(0);
    expect(sdlt("40000", "additional")).toBe(pounds(2_000));
    const under = run({ price: "39999", buyer: "additional", nonResident: true });
    expect(under.ok && under.notes).toEqual(["exempt-under-40k"]);
    expect(under.ok && under.totalPence).toBe(0);
  });
});

describe("the non-resident surcharge", () => {
  it("adds 2% on top of the rates that apply", () => {
    expect(sdlt("295000", "home", true)).toBe(pounds(4_750 + 5_900));
    // First-time buyer: 2% to £300,000, then 7% to £500,000.
    expect(sdlt("500000", "first", true)).toBe(pounds(6_000 + 14_000));
    // Higher rates and surcharge together: 7%, 9%, 12% on £300,000.
    expect(sdlt("300000", "additional", true)).toBe(pounds(8_750 + 11_250 + 6_000));
  });
});

describe("huge, zero, negative and empty prices", () => {
  it("works to the cap of £1 billion", () => {
    expect(sdlt(String(MAX_PRICE))).toBe(pounds(2_500 + 33_750 + 57_500 + 119_820_000));
    expect(sdlt(String(MAX_PRICE + 1))).toBe(MESSAGES.price);
  });

  it("refuses zero, negative, decimal, empty and non-numeric prices", () => {
    for (const bad of ["0", "-1", "295000.50", "", "   ", "abc", "1e6"]) {
      expect(sdlt(bad)).toBe(MESSAGES.price);
    }
    expect(sdlt("£ 295,000")).toBe(pounds(4_750));
  });
});

describe("formatting", () => {
  it("shows pence only when there are some, and the effective rate", () => {
    expect(formatPence(pounds(4_750))).toBe("£4,750");
    expect(formatPence(pounds(2_500) + 5)).toBe("£2,500.05");
    const result = run({ price: "295000", buyer: "home", nonResident: false });
    // 4,750 / 295,000 = 1.6101...%
    expect(result.ok && formatBasisPoints(result.effectiveBasisPoints)).toBe("1.61%");
  });
});
