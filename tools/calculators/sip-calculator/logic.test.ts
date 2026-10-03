import { describe, expect, it } from "vitest";
import {
  formatMoney,
  futureValue,
  MAX_AMOUNT,
  MAX_RATE,
  MAX_YEARS,
  parseNumber,
  run,
} from "./logic";

const sip = (amount: string, rate: string, years: string) => run({ amount, rate, years });

describe("parseNumber", () => {
  it("reads plain and grouped numbers and refuses the rest", () => {
    expect(parseNumber("5,000")).toBe(5000);
    expect(parseNumber("12.5")).toBe(12.5);
    expect(parseNumber("1e3")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });
});

describe("futureValue", () => {
  it("pays at the start of each month", () => {
    // One instalment of 100 at 1% a month grows for one month.
    expect(futureValue(100, 0.01, 1)).toBeCloseTo(101, 9);
    expect(futureValue(100, 0.01, 2)).toBeCloseTo(101 + 102.01, 9);
  });

  it("adds the instalments at 0%", () => {
    expect(futureValue(500, 0, 24)).toBe(12000);
  });
});

describe("run", () => {
  it("answers the example of its page", () => {
    const result = sip("5000", "12", "10");
    if (!result.ok) throw new Error(result.error);
    expect(result.months).toBe(120);
    expect(formatMoney(result.invested)).toBe("600,000.00");
    expect(formatMoney(result.returns)).toBe("561,695.38");
    expect(formatMoney(result.total)).toBe("1,161,695.38");
    expect(result.table).toHaveLength(10);
    expect(formatMoney(result.table[0]?.value ?? 0)).toBe("64,046.64");
    expect(formatMoney(result.table[0]?.invested ?? 0)).toBe("60,000.00");
  });

  it("handles a 0% return: value equals what was paid in", () => {
    const result = sip("1,000", "0", "2");
    if (!result.ok) throw new Error(result.error);
    expect(result.total).toBe(24000);
    expect(result.returns).toBe(0);
    expect(result.table.map((row) => row.value)).toEqual([12000, 24000]);
  });

  it("accepts the limits themselves", () => {
    expect(sip(String(MAX_AMOUNT), String(MAX_RATE), String(MAX_YEARS))).toMatchObject({
      ok: true,
      months: 600,
    });
    expect(sip("1", "0", "1")).toMatchObject({ ok: true, months: 12 });
  });
});

describe("errors", () => {
  it("names the empty box", () => {
    expect(sip("", "12", "10")).toEqual({
      ok: false,
      field: "amount",
      error: "Enter the monthly investment.",
    });
    expect(sip("1", "", "10")).toMatchObject({ field: "rate" });
    expect(sip("1", "12", " ")).toMatchObject({ field: "years" });
  });

  it("explains an unreadable number", () => {
    expect(sip("abc", "12", "10")).toMatchObject({ ok: false, field: "amount" });
  });

  it("refuses amounts of 0, below 0 and one over the limit", () => {
    expect(sip("0", "12", "10")).toMatchObject({ ok: false, field: "amount" });
    expect(sip("-1", "12", "10")).toMatchObject({ ok: false, field: "amount" });
    expect(sip("10000000.01", "12", "10")).toMatchObject({ ok: false, field: "amount" });
  });

  it("refuses a return below 0 or above 50", () => {
    expect(sip("1000", "-0.1", "10")).toMatchObject({ ok: false, field: "rate" });
    expect(sip("1000", "50.01", "10")).toMatchObject({ ok: false, field: "rate" });
  });

  it("refuses 0 years, a fraction of a year and 51 years", () => {
    expect(sip("1000", "12", "0")).toMatchObject({ ok: false, field: "years" });
    expect(sip("1000", "12", "1.5")).toMatchObject({ ok: false, field: "years" });
    expect(sip("1000", "12", "51")).toEqual({
      ok: false,
      field: "years",
      error: "The number of years must be a whole number from 1 to 50.",
    });
  });
});
