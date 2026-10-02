import { describe, expect, it } from "vitest";
import {
  FREQUENCIES,
  type Frequency,
  formatMoney,
  MAX_AMOUNT,
  MAX_YEARS,
  parseNumber,
  run,
} from "./logic";

const calc = (
  principal: string,
  rate: string,
  years: string,
  frequency: Frequency = "12",
  deposit = "",
) => run({ principal, rate, years, frequency, deposit });

function ok(result: ReturnType<typeof run>) {
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe("formatMoney and parseNumber", () => {
  it("format with two decimals and never a negative zero", () => {
    expect(formatMoney(16470.0949)).toBe("16,470.09");
    expect(formatMoney(-0.0000001)).toBe("0.00");
  });

  it("read plain and grouped numbers only", () => {
    expect(parseNumber("10,000")).toBe(10000);
    expect(parseNumber("5.5")).toBe(5.5);
    expect(parseNumber("1e3")).toBeNull();
    expect(parseNumber("1,5")).toBeNull();
  });
});

describe("run", () => {
  it("answers the example of its page", () => {
    const result = ok(calc("10000", "5", "10", "12"));
    expect(formatMoney(result.endBalance)).toBe("16,470.09");
    expect(formatMoney(result.interest)).toBe("6,470.09");
    expect(formatMoney(result.contributed)).toBe("10,000.00");
    expect(result.years).toHaveLength(10);
    const first = result.years[0];
    expect(
      first && [formatMoney(first.start), formatMoney(first.interest), formatMoney(first.end)],
    ).toEqual(["10,000.00", "511.62", "10,511.62"]);
  });

  it("matches the closed formula, for every frequency and with a deposit", () => {
    for (const frequency of FREQUENCIES) {
      const n = Number(frequency);
      const i = 0.06 / n;
      const periods = n * 20;
      const growth = (1 + i) ** periods;
      const expected = 5000 * growth + (200 * (growth - 1)) / i;
      const result = ok(calc("5000", "6", "20", frequency, "200"));
      expect(result.endBalance / expected, frequency).toBeCloseTo(1, 10);
    }
  });

  it("compounds more often to a larger balance", () => {
    const yearly = ok(calc("10000", "5", "10", "1")).endBalance;
    const monthly = ok(calc("10000", "5", "10", "12")).endBalance;
    const daily = ok(calc("10000", "5", "10", "365")).endBalance;
    expect(formatMoney(yearly)).toBe("16,288.95");
    expect(monthly).toBeGreaterThan(yearly);
    expect(daily).toBeGreaterThan(monthly);
  });

  it("adds each deposit after that period's interest", () => {
    // One year, yearly: 1000 earns 10% = 100, then 500 is added.
    const result = ok(calc("1000", "10", "1", "1", "500"));
    expect(result.endBalance).toBeCloseTo(1600, 9);
    expect(result.years[0]).toMatchObject({ start: 1000, deposits: 500, end: 1600 });
    expect(result.years[0]?.interest).toBeCloseTo(100, 9);
  });

  it("splits what was put in from what was earned", () => {
    const result = ok(calc("5000", "6", "20", "12", "200"));
    expect(result.contributed).toBe(5000 + 200 * 12 * 20);
    expect(result.interest).toBeCloseTo(result.endBalance - result.contributed, 6);
    const interest = result.years.reduce((sum, row) => sum + row.interest, 0);
    expect(interest).toBeCloseTo(result.interest, 4);
  });

  it("chains the years: each year starts where the last one ended", () => {
    const result = ok(calc("1234.56", "7.5", "15", "4", "75"));
    result.years.forEach((row, index) => {
      expect(row.year).toBe(index + 1);
      expect(row.end).toBeCloseTo(row.start + row.deposits + row.interest, 6);
      const next = result.years[index + 1];
      if (next) expect(next.start).toBe(row.end);
    });
  });

  it("handles a 0% rate, an empty deposit and a deposit with no starting amount", () => {
    expect(ok(calc("1000", "0", "5", "12"))).toMatchObject({ endBalance: 1000, interest: 0 });
    expect(ok(calc("0", "0", "2", "12", "100"))).toMatchObject({ endBalance: 2400, interest: 0 });
    expect(ok(calc("0", "8", "30", "12", "500")).contributed).toBe(180000);
  });

  it("accepts the limits themselves", () => {
    expect(calc("1,000", "100", "1", "1").ok).toBe(true);
    expect(calc("1000", "5", String(MAX_YEARS), "365").ok).toBe(true);
    expect(calc("0", "5", "1", "12", String(MAX_AMOUNT)).ok).toBe(true);
    expect(calc(String(MAX_AMOUNT), "0", "1", "1").ok).toBe(true);
  });
});

describe("errors", () => {
  it("names the empty and unreadable boxes", () => {
    expect(calc("", "5", "10")).toMatchObject({ ok: false, field: "principal" });
    expect(calc("1000", "", "10")).toEqual({
      ok: false,
      field: "rate",
      error: "Enter the yearly interest rate.",
    });
    expect(calc("1000", "5", "")).toEqual({
      ok: false,
      field: "years",
      error: "Enter the number of years.",
    });
    const bad = calc("1000", "five", "10");
    expect(!bad.ok && bad.error).toBe(
      "The yearly interest rate is not a number. Use digits, with a decimal point if needed, such as 5.5.",
    );
    expect(calc("1000", "5", "10", "12", "lots")).toMatchObject({ ok: false, field: "deposit" });
  });

  it("refuses values outside the limits", () => {
    expect(calc("-1", "5", "10")).toMatchObject({ ok: false, field: "principal" });
    expect(calc(String(MAX_AMOUNT * 2), "5", "10")).toMatchObject({
      ok: false,
      field: "principal",
    });
    expect(calc("1000", "-1", "10")).toMatchObject({ ok: false, field: "rate" });
    expect(calc("1000", "100.1", "10")).toMatchObject({ ok: false, field: "rate" });
    for (const years of ["0", "101", "2.5", "-3"]) {
      expect(calc("1000", "5", years), years).toMatchObject({ ok: false, field: "years" });
    }
    expect(calc("1000", "5", "10", "12", "-5")).toMatchObject({ ok: false, field: "deposit" });
  });

  it("needs a starting amount or a deposit above 0", () => {
    expect(calc("0", "5", "10", "12", "")).toEqual({
      ok: false,
      field: "principal",
      error: "Enter a starting amount or a regular deposit that is more than 0.",
    });
    expect(calc("0", "5", "10", "12", "0")).toMatchObject({ ok: false });
  });

  it("refuses a balance too large to show accurately", () => {
    const result = calc(String(MAX_AMOUNT), "100", "100", "365");
    expect(result).toMatchObject({ ok: false, field: "years" });
    expect(!result.ok && result.error).toContain("1,000,000,000,000,000");
  });
});
