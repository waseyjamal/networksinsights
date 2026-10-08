import { describe, expect, it } from "vitest";
import {
  amortize,
  byYear,
  formatCents,
  formatMonths,
  type Input,
  MESSAGES,
  monthlyInterest,
  monthlyPayment,
  parseCents,
  parseRate,
  run,
} from "./logic";

const BASE: Input = {
  price: "250,000",
  down: "50,000",
  rate: "6",
  years: "30",
  tax: "",
  insurance: "",
  pmi: "",
  extra: "",
};

const loan = (input: Partial<Input>) => run({ ...BASE, ...input });

describe("the amortization table of $200,000 at 6% over 30 years", () => {
  const rows = amortize(20_000_000, 6000, 360, 0);

  it("pays $1,199.10 a month", () => {
    expect(monthlyPayment(20_000_000, 6000, 360)).toBe(119_910);
  });

  it("matches the first three rows worked by hand at 0.5% a month", () => {
    expect(rows.slice(0, 3)).toEqual([
      { month: 1, interest: 100_000, principal: 19_910, paid: 119_910, balance: 19_980_090 },
      { month: 2, interest: 99_900, principal: 20_010, paid: 119_910, balance: 19_960_080 },
      { month: 3, interest: 99_800, principal: 20_110, paid: 119_910, balance: 19_939_970 },
    ]);
  });

  it("ends at nil after 360 payments, and the payments equal principal plus interest", () => {
    expect(rows).toHaveLength(360);
    expect(rows.at(-1)?.balance).toBe(0);
    const interest = rows.reduce((sum, row) => sum + row.interest, 0);
    const paid = rows.reduce((sum, row) => sum + row.paid, 0);
    const principal = rows.reduce((sum, row) => sum + row.principal, 0);
    expect(principal).toBe(20_000_000);
    expect(paid).toBe(20_000_000 + interest);
    // Every payment but the last is the level payment. The level payment is rounded down from
    // $1,199.1010, so the last one clears the $1.04 that leaves behind: $1,200.14.
    expect(rows.slice(0, -1).every((row) => row.paid === 119_910)).toBe(true);
    expect(rows.at(-1)?.paid).toBe(120_014);
    expect(interest).toBe(119_910 * 359 + 120_014 - 20_000_000);
  });

  it("pays $599.55 on $100,000 at the same rate and term", () => {
    expect(monthlyPayment(10_000_000, 6000, 360)).toBe(59_955);
  });
});

describe("the year-by-year summary", () => {
  it("sums twelve months a year and keeps the balance after the last", () => {
    const rows = amortize(20_000_000, 6000, 360, 0);
    const years = byYear(rows);
    expect(years).toHaveLength(30);
    const first = rows.slice(0, 12);
    expect(years[0]).toEqual({
      month: 1,
      interest: first.reduce((sum, row) => sum + row.interest, 0),
      principal: first.reduce((sum, row) => sum + row.principal, 0),
      paid: 119_910 * 12,
      balance: rows[11]?.balance,
    });
    expect(years[0]?.balance).toBe(19_754_399);
    expect(years.reduce((sum, row) => sum + row.paid, 0)).toBe(
      rows.reduce((sum, row) => sum + row.paid, 0),
    );
    expect(years.at(-1)?.balance).toBe(0);
  });

  it("keeps a part year as its own row", () => {
    expect(byYear(amortize(20_000_000, 6000, 360, 20_000))).toHaveLength(21);
    expect(byYear(amortize(100_000, 6000, 12, 0))).toHaveLength(1);
  });
});

describe("rounding", () => {
  it("rounds each month's interest half up to the cent", () => {
    // 100 cents at 0.5% is half a cent, so 1; 99 cents is 0.495, so 0.
    expect(monthlyInterest(100, 6000)).toBe(1);
    expect(monthlyInterest(99, 6000)).toBe(0);
    // Exact at the largest balance: $100 million at 30% is $2.5 million a month.
    expect(monthlyInterest(10_000_000_000, 30_000)).toBe(250_000_000);
  });
});

describe("run", () => {
  it("adds tax, insurance and PMI to principal and interest", () => {
    const result = loan({ tax: "3,000", insurance: "1,200", pmi: "75.50" });
    expect(result).toMatchObject({
      ok: true,
      loan: 20_000_000,
      principalAndInterest: 119_910,
      monthlyTax: 25_000,
      monthlyInsurance: 10_000,
      pmi: 7_550,
      monthlyTotal: 119_910 + 25_000 + 10_000 + 7_550,
      payments: 360,
    });
  });

  it("rounds a twelfth of the yearly costs half up to the cent", () => {
    // $1,000.06 a year is 8,333.83… cents a month; $0.06 is 0.5 cents, so 1.
    expect(loan({ tax: "1000.06" })).toMatchObject({ monthlyTax: 8_334 });
    expect(loan({ insurance: "0.06" })).toMatchObject({ monthlyInsurance: 1 });
  });

  it("pays off sooner with an extra $200 a month, and still adds up", () => {
    const plain = loan({});
    const extra = loan({ extra: "200" });
    if (!plain.ok || !extra.ok) throw new Error("both should work");
    expect(extra.payments).toBeLessThan(360);
    expect(extra.totalInterest).toBeLessThan(plain.totalInterest);
    expect(extra.totalPaid).toBe(extra.loan + extra.totalInterest);
    expect(extra.schedule.at(-1)?.balance).toBe(0);
    expect(extra.schedule[0]).toMatchObject({ principal: 19_910 + 20_000, paid: 139_910 });
  });

  it("clears the loan in one month when the extra payment covers it", () => {
    const result = loan({ price: "1000", down: "0", extra: "5000" });
    expect(result).toMatchObject({ ok: true, payments: 1, totalInterest: 500, totalPaid: 100_500 });
  });

  it("splits a 0% loan evenly", () => {
    const result = loan({ price: "120000", down: "0", rate: "0", years: "1" });
    expect(result).toMatchObject({
      ok: true,
      principalAndInterest: 1_000_000,
      totalInterest: 0,
      totalPaid: 12_000_000,
      payments: 12,
    });
  });

  it("works at the largest price, rate and term", () => {
    const result = loan({ price: "100,000,000", down: "0", rate: "30", years: "40" });
    if (!result.ok) throw new Error(result.error);
    expect(result.payments).toBe(480);
    expect(result.totalPaid).toBe(result.loan + result.totalInterest);
    expect(result.schedule.at(-1)?.balance).toBe(0);
  });

  it("refuses wrong, empty, zero and negative inputs", () => {
    expect(loan({ price: "" })).toMatchObject({ ok: false, field: "price", error: MESSAGES.price });
    expect(loan({ price: "0" })).toMatchObject({ field: "price" });
    expect(loan({ price: "-1" })).toMatchObject({ field: "price" });
    expect(loan({ price: "100,000,000.01" })).toMatchObject({ field: "price" });
    expect(loan({ down: "250000" })).toMatchObject({ field: "down", error: MESSAGES.down });
    expect(loan({ down: "" })).toMatchObject({ field: "down" });
    expect(loan({ rate: "30.001" })).toMatchObject({ field: "rate", error: MESSAGES.rate });
    expect(loan({ rate: "6.1234" })).toMatchObject({ field: "rate" });
    expect(loan({ rate: "-1" })).toMatchObject({ field: "rate" });
    expect(loan({ years: "0" })).toMatchObject({ field: "years", error: MESSAGES.years });
    expect(loan({ years: "41" })).toMatchObject({ field: "years" });
    expect(loan({ years: "15.5" })).toMatchObject({ field: "years" });
    expect(loan({ tax: "12.345" })).toMatchObject({ field: "tax" });
    expect(loan({ extra: "-5" })).toMatchObject({ field: "extra" });
  });
});

describe("parsing and formatting", () => {
  it("reads dollars, cents and rates", () => {
    expect(parseCents("$1,234.5")).toBe(123_450);
    expect(parseCents("1e3")).toBeNull();
    expect(parseRate("6.875%")).toBe(6875);
    expect(parseRate("0")).toBe(0);
  });

  it("shows dollars and months", () => {
    expect(formatCents(119_910)).toBe("$1,199.10");
    expect(formatMonths(360)).toBe("30 years");
    expect(formatMonths(295)).toBe("24 years 7 months");
    expect(formatMonths(1)).toBe("1 month");
  });
});
