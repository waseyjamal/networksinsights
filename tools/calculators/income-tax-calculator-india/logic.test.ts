import { describe, expect, it } from "vitest";
import { computeRegime, formatRupees, MAX_RUPEES, MESSAGES, parseRupees, run } from "./logic";

const newTax = (salary: number, other = 0) => computeRegime("new", salary, other, 0, "below60");
const oldTax = (other: number, age: "below60" | "60to79" | "80plus" = "below60", deductions = 0) =>
  computeRegime("old", 0, other, deductions, age);

describe("new regime, tax year 2026-27", () => {
  it("is nil for a salary of 12,75,000: the standard deduction and the rebate", () => {
    const result = newTax(1_275_000);
    expect(result).toMatchObject({
      standardDeduction: 75_000,
      taxable: 1_200_000,
      slabTax: 60_000,
      rebate: 60_000,
      total: 0,
    });
  });

  it("gives marginal relief just above 12 lakh", () => {
    // 12,25,000 taxable: slab tax 63,750, but tax may not exceed the 25,000 above 12 lakh.
    expect(newTax(1_300_000)).toMatchObject({
      taxable: 1_225_000,
      slabTax: 63_750,
      rebate: 38_750,
      cess: 1_000,
      total: 26_000,
    });
    expect(newTax(0, 1_210_000)).toMatchObject({ slabTax: 61_500, total: 10_400 });
    // Far enough above, relief stops: 13,00,000 taxable, slab tax 75,000 is less than 1,00,000.
    expect(newTax(0, 1_300_000)).toMatchObject({ rebate: 0, total: 78_000 });
  });

  it("follows the slabs to 30%", () => {
    expect(newTax(0, 2_400_000)).toMatchObject({ slabTax: 300_000, total: 312_000 });
    expect(newTax(0, 5_000_000)).toMatchObject({
      slabTax: 1_080_000,
      surcharge: 0,
      total: 1_123_200,
    });
  });

  it("adds a 10% surcharge above 50 lakh, with marginal relief", () => {
    // At 50,10,000 a full 10% would be 1,08,300; relief caps tax and surcharge at 10,90,000.
    expect(newTax(0, 5_010_000)).toMatchObject({
      slabTax: 1_083_000,
      surcharge: 7_000,
      cess: 43_600,
      total: 1_133_600,
    });
  });

  it("stops the surcharge at 25% above 2 crore", () => {
    expect(newTax(0, 60_000_000)).toMatchObject({
      slabTax: 17_580_000,
      surcharge: 4_395_000,
      cess: 879_000,
      total: 22_854_000,
    });
  });

  it("gives the standard deduction only on salary, up to the salary", () => {
    expect(newTax(40_000)).toMatchObject({ standardDeduction: 40_000, taxable: 0, total: 0 });
    expect(newTax(0, 1_275_000)).toMatchObject({ standardDeduction: 0, taxable: 1_275_000 });
  });

  it("ignores old-regime deductions", () => {
    expect(computeRegime("new", 0, 1_500_000, 150_000, "below60").deductions).toBe(0);
  });
});

describe("old regime, tax year 2026-27", () => {
  it("uses the age slabs", () => {
    expect(oldTax(250_000).total).toBe(0);
    expect(oldTax(1_000_000)).toMatchObject({ slabTax: 112_500, total: 117_000 });
    expect(oldTax(1_000_000, "60to79")).toMatchObject({ slabTax: 110_000 });
    expect(oldTax(1_000_000, "80plus")).toMatchObject({ slabTax: 100_000 });
  });

  it("gives the 12,500 rebate up to 5 lakh only, with no marginal relief", () => {
    expect(oldTax(500_000)).toMatchObject({ slabTax: 12_500, rebate: 12_500, total: 0 });
    expect(oldTax(500_001)).toMatchObject({ rebate: 0, total: 13_000 });
  });

  it("takes the 50,000 standard deduction and the deductions entered", () => {
    const result = computeRegime("old", 1_000_000, 0, 150_000, "below60");
    expect(result).toMatchObject({
      standardDeduction: 50_000,
      deductions: 150_000,
      taxable: 800_000,
    });
    expect(result.slabTax).toBe(72_500);
    expect(computeRegime("old", 0, 100_000, 900_000, "below60")).toMatchObject({
      deductions: 100_000,
      taxable: 0,
    });
  });

  it("adds a 37% surcharge above 5 crore", () => {
    const result = oldTax(60_000_000);
    expect(result.slabTax).toBe(17_812_500);
    expect(result.surcharge).toBe(6_590_625);
    expect(result.total).toBe(25_379_250);
  });
});

describe("run and input", () => {
  it("compares both regimes", () => {
    const result = run({ salary: "15,00,000", other: "", deductions: "2,00,000", age: "below60" });
    if (!result.ok) throw new Error(result.error);
    expect(result.new.total).toBe(97_500);
    expect(result.old.total).toBe(195_000);
    expect(result.lower).toBe("new");
    const nil = run({ salary: "", other: "", deductions: "", age: "below60" });
    expect(nil.ok && nil.lower).toBe("same");
  });

  it("reads whole rupees and refuses the rest", () => {
    expect(parseRupees("₹ 12,75,000")).toBe(1_275_000);
    expect(parseRupees("")).toBe(0);
    expect(parseRupees("12.5")).toBeUndefined();
    expect(parseRupees("-5")).toBeUndefined();
    expect(parseRupees(String(MAX_RUPEES))).toBe(MAX_RUPEES);
    expect(parseRupees(String(MAX_RUPEES + 1))).toBeUndefined();
    expect(run({ salary: "abc", other: "", deductions: "", age: "below60" })).toEqual({
      ok: false,
      field: "salary",
      error: MESSAGES.amount("the salary"),
    });
    expect(run({ salary: String(MAX_RUPEES), other: "1", deductions: "", age: "below60" })).toEqual(
      { ok: false, field: "other", error: MESSAGES.total },
    );
    expect(MESSAGES.total).toBe(
      "Salary and other income together can be at most ₹10,00,00,00,000.",
    );
  });

  it("writes rupees in the Indian grouping", () => {
    expect(formatRupees(1_275_000)).toBe("₹12,75,000");
  });
});
