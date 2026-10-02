import { describe, expect, it } from "vitest";
import { formatNumber, MAX_ABS, type Mode, type Operation, parseNumber, run } from "./logic";

const ask = (mode: Mode, a: string, b: string, operation: Operation = "add") =>
  run({ mode, a, b, operation });

describe("parseNumber", () => {
  it("reads plain, signed, decimal and grouped numbers", () => {
    expect(parseNumber("12")).toBe(12);
    expect(parseNumber(" -3.5 ")).toBe(-3.5);
    expect(parseNumber("+7")).toBe(7);
    expect(parseNumber(".5")).toBe(0.5);
    expect(parseNumber("5.")).toBe(5);
    expect(parseNumber("1,234,567.89")).toBe(1234567.89);
  });

  it("refuses text that is not a number", () => {
    for (const bad of [
      "",
      "abc",
      "1,2",
      "12,34",
      "1e5",
      "--1",
      "1 000",
      "Infinity",
      "0x10",
      "1.2.3",
    ]) {
      expect(parseNumber(bad), bad).toBeNull();
    }
  });
});

describe("formatNumber", () => {
  it("groups digits, trims zeros and rounds to six decimals", () => {
    expect(formatNumber(1234567.5)).toBe("1,234,567.5");
    expect(formatNumber(1 / 3)).toBe("0.333333");
    expect(formatNumber(2)).toBe("2");
  });

  it("never shows a negative zero", () => {
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(-0.0000001)).toBe("0");
  });
});

describe("X% of Y", () => {
  it("answers the example of its page", () => {
    expect(ask("of", "15", "80")).toMatchObject({
      ok: true,
      value: 12,
      text: "12",
      sentence: "15% of 80 is 12.",
    });
  });

  it("handles decimals, negatives and zero", () => {
    expect(ask("of", "12.5", "200")).toMatchObject({ ok: true, value: 25 });
    expect(ask("of", "50", "-10")).toMatchObject({ ok: true, value: -5 });
    expect(ask("of", "0", "80")).toMatchObject({ ok: true, value: 0 });
    expect(ask("of", "150", "80")).toMatchObject({ ok: true, value: 120 });
  });
});

describe("X is what % of Y", () => {
  it("answers the example of its page", () => {
    expect(ask("whatPercent", "20", "80")).toMatchObject({ ok: true, value: 25, text: "25%" });
  });

  it("allows a number larger than the total", () => {
    expect(ask("whatPercent", "30", "20")).toMatchObject({ ok: true, text: "150%" });
  });

  it("refuses a total of 0", () => {
    expect(ask("whatPercent", "5", "0")).toMatchObject({ ok: false, field: "b" });
    expect(ask("whatPercent", "5", "-0")).toMatchObject({ ok: false, field: "b" });
  });
});

describe("percentage change", () => {
  it("shows an increase", () => {
    const result = ask("change", "50", "75");
    expect(result).toMatchObject({ ok: true, value: 50, text: "50%" });
    expect(result.ok && result.sentence).toBe("From 50 to 75 is an increase of 50%.");
    expect(result.ok && result.extras).toEqual([{ label: "Difference", value: "25" }]);
  });

  it("shows a decrease and no change", () => {
    const down = ask("change", "80", "60");
    expect(down.ok && down.sentence).toBe("From 80 to 60 is a decrease of 25%.");
    expect(down.ok && down.text).toBe("-25%");
    const same = ask("change", "5", "5");
    expect(same.ok && same.sentence).toBe("From 5 to 5 is no change.");
  });

  it("measures against the size of a negative start", () => {
    expect(ask("change", "-50", "-25")).toMatchObject({ ok: true, value: 50 });
  });

  it("refuses a start of 0", () => {
    expect(ask("change", "0", "10")).toMatchObject({ ok: false, field: "a" });
  });
});

describe("add or subtract a percent", () => {
  it("adds", () => {
    const result = ask("addSub", "20", "50", "add");
    expect(result).toMatchObject({ ok: true, value: 60, sentence: "Adding 20% to 50 gives 60." });
    expect(result.ok && result.extras).toEqual([{ label: "20% of 50", value: "10" }]);
  });

  it("subtracts", () => {
    const result = ask("addSub", "20", "50", "subtract");
    expect(result).toMatchObject({
      ok: true,
      value: 40,
      sentence: "Subtracting 20% from 50 gives 40.",
    });
  });

  it("can go below zero when subtracting more than 100%", () => {
    expect(ask("addSub", "150", "10", "subtract")).toMatchObject({ ok: true, value: -5 });
  });
});

describe("errors", () => {
  it("names the empty box", () => {
    expect(ask("of", "", "80")).toEqual({
      ok: false,
      field: "a",
      error: "Enter a number for Percent (X).",
    });
    expect(ask("of", "15", "  ")).toEqual({
      ok: false,
      field: "b",
      error: "Enter a number for Number (Y).",
    });
  });

  it("explains an unreadable number", () => {
    const result = ask("of", "abc", "80");
    expect(!result.ok && result.error).toContain("is not a number");
  });

  it("refuses numbers beyond the limit, and accepts the limit itself", () => {
    expect(ask("of", String(MAX_ABS * 10), "1")).toMatchObject({ ok: false, field: "a" });
    expect(ask("of", "100", String(MAX_ABS))).toMatchObject({ ok: true, value: MAX_ABS });
  });
});
