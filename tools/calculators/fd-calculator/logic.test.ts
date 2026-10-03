import { describe, expect, it } from "vitest";
import { type Compounding, formatMoney, type Input, run, type Unit, valueAfter } from "./logic";

const fd = (
  amount: string,
  rate: string,
  tenure: string,
  unit: Unit = "years",
  compounding: Compounding = "quarterly",
) => run({ amount, rate, tenure, unit, compounding } satisfies Input);

const maturity = (result: ReturnType<typeof run>) => {
  if (!result.ok) throw new Error(result.error);
  return formatMoney(result.maturity);
};

describe("valueAfter", () => {
  it("compounds at each frequency", () => {
    expect(valueAfter(100, 0.12, 1, "monthly")).toBeCloseTo(100 * 1.01 ** 12, 9);
    expect(valueAfter(100, 0.08, 1, "quarterly")).toBeCloseTo(100 * 1.02 ** 4, 9);
    expect(valueAfter(100, 0.1, 1, "half-yearly")).toBeCloseTo(110.25, 9);
    expect(valueAfter(100, 0.1, 2, "yearly")).toBeCloseTo(121, 9);
    expect(valueAfter(100, 0.1, 2, "simple")).toBeCloseTo(120, 9);
  });
});

describe("run", () => {
  it("answers the example of its page", () => {
    const result = fd("100000", "7", "5");
    if (!result.ok) throw new Error(result.error);
    expect(formatMoney(result.maturity)).toBe("141,477.82");
    expect(formatMoney(result.interest)).toBe("41,477.82");
    expect(result.table).toHaveLength(5);
    expect(formatMoney(result.table[0]?.value ?? 0)).toBe("107,185.90");
  });

  it("reads months and days", () => {
    expect(maturity(fd("100000", "7", "30", "months"))).toBe("118,944.45");
    expect(maturity(fd("100000", "7", "90", "days"))).toBe("101,725.82");
    const result = fd("100000", "7", "30", "months");
    expect(result.ok && result.table.map((row) => row.label)).toEqual(["1", "2", "At maturity"]);
  });

  it("pays simple interest at maturity", () => {
    expect(maturity(fd("100000", "7", "6", "months", "simple"))).toBe("103,500.00");
  });

  it("handles a 0% rate", () => {
    const result = fd("50,000", "0", "3", "years", "monthly");
    if (!result.ok) throw new Error(result.error);
    expect(result.maturity).toBe(50000);
    expect(result.interest).toBe(0);
  });

  it("accepts the limits themselves", () => {
    expect(fd("1000000000000", "50", "50")).toMatchObject({ ok: true });
    expect(fd("1", "0", "600", "months")).toMatchObject({ ok: true });
    expect(fd("1", "0", "18250", "days")).toMatchObject({ ok: true });
    expect(fd("1", "0", "1", "days")).toMatchObject({ ok: true });
  });
});

describe("errors", () => {
  it("names the empty box", () => {
    expect(fd("", "7", "5")).toEqual({
      ok: false,
      field: "amount",
      error: "Enter the deposit amount.",
    });
    expect(fd("1", "", "5")).toMatchObject({ field: "rate" });
    expect(fd("1", "7", "")).toMatchObject({ field: "tenure" });
  });

  it("refuses amounts of 0 and one over the limit", () => {
    expect(fd("0", "7", "5")).toMatchObject({ ok: false, field: "amount" });
    expect(fd("1000000000000.01", "7", "5")).toMatchObject({ ok: false, field: "amount" });
    expect(fd("abc", "7", "5")).toMatchObject({ ok: false, field: "amount" });
  });

  it("refuses a rate below 0 or above 50", () => {
    expect(fd("1", "-1", "5")).toMatchObject({ ok: false, field: "rate" });
    expect(fd("1", "50.01", "5")).toMatchObject({ ok: false, field: "rate" });
  });

  it("refuses a tenure past its unit's limit or not whole", () => {
    expect(fd("1", "7", "51")).toEqual({
      ok: false,
      field: "tenure",
      error: "The tenure must be a whole number from 1 to 50 years.",
    });
    expect(fd("1", "7", "601", "months")).toMatchObject({ ok: false });
    expect(fd("1", "7", "18251", "days")).toMatchObject({
      error: "The tenure must be a whole number from 1 to 18,250 days.",
    });
    expect(fd("1", "7", "0", "days")).toMatchObject({ ok: false });
    expect(fd("1", "7", "1.5")).toMatchObject({ ok: false });
  });
});
