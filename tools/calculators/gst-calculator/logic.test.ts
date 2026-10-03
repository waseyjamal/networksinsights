import { describe, expect, it } from "vitest";
import { formatMoney, MAX_AMOUNT, run, SLABS } from "./logic";

const shown = (result: ReturnType<typeof run>) => {
  if (!result.ok) throw new Error(result.error);
  return [result.base, result.gst, result.cgst, result.sgst, result.total].map(formatMoney);
};

describe("run", () => {
  it("adds GST: the example of its page", () => {
    expect(shown(run({ amount: "10000", rate: "18", mode: "add" }))).toEqual([
      "10,000.00",
      "1,800.00",
      "900.00",
      "900.00",
      "11,800.00",
    ]);
  });

  it("removes GST from an inclusive price", () => {
    expect(shown(run({ amount: "11,800", rate: "18", mode: "remove" }))).toEqual([
      "10,000.00",
      "1,800.00",
      "900.00",
      "900.00",
      "11,800.00",
    ]);
    expect(shown(run({ amount: "105", rate: "5", mode: "remove" }))).toEqual([
      "100.00",
      "5.00",
      "2.50",
      "2.50",
      "105.00",
    ]);
  });

  it("takes any typed rate, including 0 and a decimal", () => {
    expect(shown(run({ amount: "100", rate: "0", mode: "add" }))[4]).toBe("100.00");
    expect(shown(run({ amount: "1000", rate: "0.25", mode: "add" }))[1]).toBe("2.50");
    expect(shown(run({ amount: "1000", rate: "40", mode: "add" }))[4]).toBe("1,400.00");
  });

  it("offers the 5, 18 and 40 percent slabs", () => {
    expect(SLABS).toEqual(["5", "18", "40"]);
  });

  it("accepts the limits themselves", () => {
    expect(run({ amount: String(MAX_AMOUNT), rate: "100", mode: "add" })).toMatchObject({
      ok: true,
      total: 2 * MAX_AMOUNT,
    });
    expect(run({ amount: "0", rate: "18", mode: "add" })).toMatchObject({ ok: true, total: 0 });
  });
});

describe("errors", () => {
  it("names the empty box", () => {
    expect(run({ amount: "", rate: "18", mode: "add" })).toEqual({
      ok: false,
      field: "amount",
      error: "Enter the amount.",
    });
    expect(run({ amount: "1", rate: " ", mode: "add" })).toMatchObject({ field: "rate" });
  });

  it("refuses an unreadable, negative or too large amount", () => {
    expect(run({ amount: "abc", rate: "18", mode: "add" })).toMatchObject({ field: "amount" });
    expect(run({ amount: "-1", rate: "18", mode: "add" })).toMatchObject({ field: "amount" });
    expect(run({ amount: "1000000000000.01", rate: "18", mode: "add" })).toMatchObject({
      field: "amount",
    });
  });

  it("refuses a rate below 0 or above 100", () => {
    expect(run({ amount: "1", rate: "-1", mode: "add" })).toMatchObject({ field: "rate" });
    expect(run({ amount: "1", rate: "100.01", mode: "add" })).toMatchObject({ field: "rate" });
  });
});
