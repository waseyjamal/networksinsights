import { describe, expect, it } from "vitest";
import {
  amortize,
  FREQUENCIES,
  type Input,
  levelPayment,
  MESSAGES,
  minimumDown,
  periodicRate,
  premiumRate,
  run,
} from "./logic";

const BASE: Input = {
  price: "500,000",
  down: "25,000",
  rate: "5",
  years: "25",
  frequency: "monthly",
  premiumPaid: "added",
};

const mortgage = (input: Partial<Input>) => run({ ...BASE, ...input });
const dollars = (value: number) => Math.round(value * 100);

describe("half-yearly compounding", () => {
  it("compounds every payment frequency back to j/2 each half year", () => {
    for (const { perYear } of Object.values(FREQUENCIES)) {
      const i = periodicRate(6000, perYear);
      // Half a year of periods at the periodic rate grows by exactly 3% at 6% a year.
      expect((1 + i) ** (perYear / 2)).toBeCloseTo(1.03, 12);
      // A year grows by 6.09%, not the 6.17% of monthly compounding.
      expect((1 + i) ** perYear).toBeCloseTo(1.0609, 12);
    }
  });

  it("is not monthly compounding: 6% a year is less than 0.5% a month", () => {
    expect(periodicRate(6000, 12)).toBeCloseTo(1.03 ** (1 / 6) - 1, 15);
    expect(periodicRate(6000, 12)).toBeLessThan(0.005);
  });

  it("pays $639.81 a month on $100,000 at 6% over 25 years", () => {
    // Closed form with 300 months: (1 + i)^300 = 1.03^50 exactly.
    const i = 1.03 ** (1 / 6) - 1;
    const expected = Math.round((10_000_000 * i * 1.03 ** 50) / (1.03 ** 50 - 1));
    expect(expected).toBe(63_981);
    expect(levelPayment(10_000_000, periodicRate(6000, 12), 300)).toBe(63_981);
    // Monthly compounding would give $644.30 instead.
    expect(levelPayment(10_000_000, 0.005, 300)).toBe(64_430);
  });

  it("charges the first month's interest at the half-yearly equivalent rate", () => {
    // 100,000 × (1.03^(1/6) − 1) = $493.86; twelve months at $639.81 then sum to the year.
    const plan = amortize(10_000_000, periodicRate(6000, 12), 12, 25);
    expect(Math.round(10_000_000 * periodicRate(6000, 12))).toBe(49_386);
    expect(plan.rows[0]?.paid).toBe(63_981 * 12);
    expect((plan.rows[0]?.interest ?? 0) + (plan.rows[0]?.principal ?? 0)).toBe(63_981 * 12);
  });
});

describe("CMHC minimum down payment", () => {
  it("is 5% up to $500,000 and 10% of the rest", () => {
    expect(minimumDown(dollars(500_000))).toBe(dollars(25_000));
    expect(minimumDown(dollars(499_999))).toBe(dollars(24_999.95));
    expect(minimumDown(dollars(500_001))).toBe(dollars(25_000.1));
    expect(minimumDown(dollars(600_000))).toBe(dollars(35_000));
  });

  it("refuses a down payment one cent below the minimum", () => {
    expect(mortgage({ down: "24,999.99" })).toEqual({
      ok: false,
      field: "down",
      error: MESSAGES.minimum(dollars(25_000)),
    });
    expect(mortgage({ price: "600000", down: "34999.99" })).toMatchObject({ field: "down" });
    expect(mortgage({ price: "600000", down: "35000" })).toMatchObject({ ok: true });
  });

  it("needs 20% down at $1,500,000 or more, where insurance is not available", () => {
    expect(mortgage({ price: "1,500,000", down: "299,999.99" })).toEqual({
      ok: false,
      field: "down",
      error: MESSAGES.uninsurable,
    });
    expect(mortgage({ price: "1,500,000", down: "300,000" })).toMatchObject({
      ok: true,
      insured: false,
      premium: 0,
    });
    // One dollar below the cap, the minimum (5% and 10%) is $124,999.90 and insurance applies.
    expect(mortgage({ price: "1,499,999", down: "124,999.90" })).toMatchObject({
      ok: true,
      insured: true,
      // $1,374,999.10 of $1,499,999 is 91.67% loan to value.
      ltvBasisPoints: 9_167,
      premiumRate: 400,
    });
  });
});

describe("CMHC premium", () => {
  it("is 4.00% at 95% loan to value: $19,000 on a $475,000 loan, added to it", () => {
    expect(mortgage({})).toMatchObject({
      ok: true,
      loan: dollars(475_000),
      ltvBasisPoints: 9_500,
      premiumRate: 400,
      premium: dollars(19_000),
      mortgage: dollars(494_000),
    });
  });

  it("is not added when it is paid separately", () => {
    expect(mortgage({ premiumPaid: "separate" })).toMatchObject({
      premium: dollars(19_000),
      mortgage: dollars(475_000),
    });
  });

  it("follows the table at each loan-to-value edge", () => {
    const price = dollars(100_000);
    expect(premiumRate(dollars(65_000), price)).toBe(60);
    expect(premiumRate(dollars(65_000.01), price)).toBe(170);
    expect(premiumRate(dollars(75_000), price)).toBe(170);
    expect(premiumRate(dollars(80_000), price)).toBe(240);
    expect(premiumRate(dollars(85_000), price)).toBe(280);
    expect(premiumRate(dollars(85_000.01), price)).toBe(310);
    expect(premiumRate(dollars(90_000), price)).toBe(310);
    expect(premiumRate(dollars(90_000.01), price)).toBe(400);
    expect(premiumRate(dollars(95_000), price)).toBe(400);
  });

  it("is not charged at exactly 20% down, and is charged one cent below", () => {
    expect(mortgage({ down: "100,000" })).toMatchObject({ insured: false, premium: 0 });
    expect(mortgage({ down: "99,999.99" })).toMatchObject({ insured: true, premiumRate: 280 });
  });
});

describe("the schedule", () => {
  it("adds up: the payments equal the mortgage plus the interest, ending at nil", () => {
    for (const frequency of Object.keys(FREQUENCIES) as Input["frequency"][]) {
      const result = mortgage({ frequency });
      if (!result.ok) throw new Error(result.error);
      expect(result.totalPaid).toBe(result.mortgage + result.totalInterest);
      expect(result.years).toHaveLength(25);
      expect(result.years.at(-1)?.balance).toBe(0);
      expect(result.payments).toBe(25 * FREQUENCIES[frequency].perYear);
      const principal = result.years.reduce((sum, row) => sum + row.principal, 0);
      expect(principal).toBe(result.mortgage);
    }
  });

  it("splits a 0% mortgage evenly", () => {
    expect(mortgage({ price: "120000", down: "24000", rate: "0", years: "1" })).toMatchObject({
      ok: true,
      mortgage: dollars(96_000),
      payment: dollars(8_000),
      totalInterest: 0,
    });
  });

  it("works at the largest price, rate and amortization", () => {
    const result = mortgage({ price: "50,000,000", down: "10,000,000", rate: "30", years: "40" });
    if (!result.ok) throw new Error(result.error);
    expect(result.totalPaid).toBe(result.mortgage + result.totalInterest);
    expect(result.years.at(-1)?.balance).toBe(0);
  });
});

describe("wrong input", () => {
  it("refuses empty, zero, negative and malformed values", () => {
    expect(mortgage({ price: "" })).toEqual({ ok: false, field: "price", error: MESSAGES.price });
    expect(mortgage({ price: "0" })).toMatchObject({ field: "price" });
    expect(mortgage({ price: "-500000" })).toMatchObject({ field: "price" });
    expect(mortgage({ price: "50,000,000.01" })).toMatchObject({ field: "price" });
    expect(mortgage({ down: "" })).toMatchObject({ field: "down", error: MESSAGES.down });
    expect(mortgage({ down: "500000" })).toMatchObject({ error: MESSAGES.downTooBig });
    expect(mortgage({ rate: "" })).toMatchObject({ field: "rate", error: MESSAGES.rate });
    expect(mortgage({ rate: "30.001" })).toMatchObject({ field: "rate" });
    expect(mortgage({ years: "0" })).toMatchObject({ field: "years", error: MESSAGES.years });
    expect(mortgage({ years: "41" })).toMatchObject({ field: "years" });
    expect(mortgage({ years: "2.5" })).toMatchObject({ field: "years" });
  });
});
