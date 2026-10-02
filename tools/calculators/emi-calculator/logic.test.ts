import { describe, expect, it } from "vitest";
import {
  formatMoney,
  type Input,
  MAX_AMOUNT,
  MAX_MONTHS,
  monthlyPayment,
  parseNumber,
  run,
} from "./logic";

const loan = (amount: string, rate: string, tenure: string, unit: Input["unit"] = "years") =>
  run({ amount, rate, tenure, unit });

describe("formatMoney", () => {
  it("groups digits and keeps two decimals", () => {
    expect(formatMoney(10258.2655)).toBe("10,258.27");
    expect(formatMoney(5)).toBe("5.00");
    expect(formatMoney(0)).toBe("0.00");
  });

  it("never shows a negative zero", () => {
    expect(formatMoney(-0.0000001)).toBe("0.00");
  });
});

describe("parseNumber", () => {
  it("reads plain and grouped numbers and refuses the rest", () => {
    expect(parseNumber("500,000")).toBe(500000);
    expect(parseNumber("8.5")).toBe(8.5);
    expect(parseNumber("1e3")).toBeNull();
    expect(parseNumber("12,34")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });
});

describe("monthlyPayment", () => {
  it("matches the textbook value for 100000 at 12% for 12 months", () => {
    expect(monthlyPayment(100000, 0.01, 12)).toBeCloseTo(8884.8788, 3);
  });

  it("divides evenly at 0%", () => {
    expect(monthlyPayment(1200, 0, 12)).toBe(100);
  });
});

describe("run", () => {
  it("answers the example of its page", () => {
    const result = loan("500000", "8.5", "5");
    if (!result.ok) throw new Error(result.error);
    expect(result.months).toBe(60);
    expect(formatMoney(result.emi)).toBe("10,258.27");
    expect(formatMoney(result.totalInterest)).toBe("115,495.94");
    expect(formatMoney(result.totalPayment)).toBe("615,495.94");
    const first = result.schedule[0];
    expect(first && [formatMoney(first.principal), formatMoney(first.interest)]).toEqual([
      "6,716.60",
      "3,541.67",
    ]);
    expect(first && formatMoney(first.balance)).toBe("493,283.40");
  });

  it("builds a schedule that repays the loan exactly", () => {
    const result = loan("100000", "12", "1");
    if (!result.ok) throw new Error(result.error);
    expect(result.schedule).toHaveLength(12);
    expect(result.schedule.at(-1)?.balance).toBe(0);
    const principal = result.schedule.reduce((sum, row) => sum + row.principal, 0);
    const interest = result.schedule.reduce((sum, row) => sum + row.interest, 0);
    expect(principal).toBeCloseTo(100000, 6);
    expect(interest).toBeCloseTo(result.totalInterest, 6);
    expect(result.schedule.map((row) => row.month)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(result.schedule.every((row) => row.payment === result.emi)).toBe(true);
  });

  it("handles a 0% rate: equal parts, no interest", () => {
    const result = loan("1200", "0", "12", "months");
    if (!result.ok) throw new Error(result.error);
    expect(result.emi).toBe(100);
    expect(result.totalInterest).toBe(0);
    expect(result.totalPayment).toBe(1200);
    expect(result.schedule[0]).toEqual({
      month: 1,
      payment: 100,
      principal: 100,
      interest: 0,
      balance: 1100,
    });
    expect(result.schedule.at(-1)?.balance).toBe(0);
  });

  it("reads the tenure in years or months", () => {
    const years = loan("100000", "10", "2", "years");
    const months = loan("100000", "10", "24", "months");
    expect(years).toEqual(months);
    expect(loan("100000", "10", "2.5", "years")).toMatchObject({ ok: true, months: 30 });
    expect(loan("100000", "10", "1", "months")).toMatchObject({ ok: true, months: 1 });
  });

  it("handles a one-month loan", () => {
    const result = loan("1000", "12", "1", "months");
    if (!result.ok) throw new Error(result.error);
    expect(result.emi).toBeCloseTo(1010, 9);
    expect(result.schedule).toHaveLength(1);
  });

  it("accepts the limits themselves", () => {
    expect(loan(String(MAX_AMOUNT), "100", "50")).toMatchObject({ ok: true, months: MAX_MONTHS });
    expect(loan("1000", "100", "600", "months")).toMatchObject({ ok: true });
    expect(loan("1,000", "0.001", "1")).toMatchObject({ ok: true });
  });
});

describe("errors", () => {
  it("names the empty box", () => {
    expect(loan("", "8", "5")).toEqual({
      ok: false,
      field: "amount",
      error: "Enter the loan amount.",
    });
    expect(loan("1", " ", "5")).toEqual({
      ok: false,
      field: "rate",
      error: "Enter the yearly interest rate.",
    });
    expect(loan("1", "8", "")).toEqual({ ok: false, field: "tenure", error: "Enter the tenure." });
  });

  it("explains an unreadable number", () => {
    const result = loan("abc", "8", "5");
    expect(!result.ok && result.field).toBe("amount");
    expect(!result.ok && result.error).toBe(
      "The loan amount is not a number. Use digits, with a decimal point if needed, such as 8.5.",
    );
  });

  it("refuses an amount of 0, a negative one and one over the limit", () => {
    expect(loan("0", "8", "5")).toMatchObject({ ok: false, field: "amount" });
    expect(loan("-5", "8", "5")).toMatchObject({ ok: false, field: "amount" });
    expect(loan(String(MAX_AMOUNT * 10), "8", "5")).toMatchObject({ ok: false, field: "amount" });
  });

  it("refuses a rate below 0 or above 100", () => {
    expect(loan("1000", "-1", "5")).toMatchObject({ ok: false, field: "rate" });
    expect(loan("1000", "100.5", "5")).toMatchObject({ ok: false, field: "rate" });
  });

  it("refuses a tenure of 0, a fraction of a month and one past 600 months", () => {
    expect(loan("1000", "8", "0")).toMatchObject({ ok: false, field: "tenure" });
    expect(loan("1000", "8", "0.01", "years")).toMatchObject({ ok: false, field: "tenure" });
    expect(loan("1000", "8", "1.5", "months")).toMatchObject({ ok: false, field: "tenure" });
    expect(loan("1000", "8", "601", "months")).toMatchObject({ ok: false, field: "tenure" });
    expect(loan("1000", "8", "51", "years")).toMatchObject({ ok: false, field: "tenure" });
  });
});
