import { describe, expect, it } from "vitest";
import { formatFraction, GROUPS, type Group, parseDecimal, run, UNITS } from "./logic";

const convert = (group: Group, value: string, from: string, to: string) =>
  run({ group, value, from, to });
const value = (group: Group, input: string, from: string, to: string) => {
  const result = convert(group, input, from, to);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

describe("formatFraction", () => {
  it("rounds to 12 significant digits with no float noise", () => {
    expect(formatFraction({ n: 1n, d: 3n })).toEqual({ text: "0.333333333333", exact: false });
    expect(formatFraction({ n: 3n, d: 10n })).toEqual({ text: "0.3", exact: true });
    expect(formatFraction({ n: -5n, d: 2n })).toEqual({ text: "-2.5", exact: true });
    expect(formatFraction({ n: 2n, d: 3n }).text).toBe("0.666666666667");
  });
});

describe("parseDecimal", () => {
  it("reads decimals exactly", () => {
    expect(parseDecimal("0.1")).toEqual({ n: 1n, d: 10n });
    expect(parseDecimal("1,234.5")).toEqual({ n: 2469n, d: 2n });
    expect(parseDecimal("1e3")).toBeNull();
  });
});

describe("factors", () => {
  it("match the exact definitions", () => {
    expect(value("length", "1", "in", "cm")).toBe("2.54");
    expect(value("length", "1", "mi", "m")).toBe("1,609.344");
    expect(value("length", "1", "nmi", "m")).toBe("1,852");
    expect(value("weight", "1", "lb", "kg")).toBe("0.45359237");
    expect(value("weight", "16", "oz", "lb")).toBe("1");
    expect(value("weight", "1", "st", "lb")).toBe("14");
    expect(value("weight", "1", "ton", "lb")).toBe("2,000");
    expect(value("area", "1", "ac", "m2")).toBe("4,046.8564224");
    expect(value("area", "1", "mi2", "ac")).toBe("640");
    expect(value("area", "1", "ha", "m2")).toBe("10,000");
    expect(value("volume", "1", "usgal", "in3")).toBe("231");
    expect(value("volume", "1", "usgal", "usfloz")).toBe("128");
    expect(value("volume", "1", "ukgal", "ukpt")).toBe("8");
    expect(value("volume", "1", "ft3", "in3")).toBe("1,728");
    expect(value("speed", "36", "kmh", "mps")).toBe("10");
    expect(value("speed", "1", "kn", "kmh")).toBe("1.852");
    expect(value("speed", "1", "mph", "fps")).toBe("1.46666666667");
    expect(value("time", "1", "wk", "h")).toBe("168");
    expect(value("time", "1", "d", "ms")).toBe("86,400,000");
  });

  it("keeps decimal and binary data sizes apart", () => {
    expect(value("data", "1", "kB", "B")).toBe("1,000");
    expect(value("data", "1", "KiB", "B")).toBe("1,024");
    expect(value("data", "1", "GiB", "GB")).toBe("1.073741824");
    expect(value("data", "1", "TB", "TiB")).toBe("0.909494701773");
    expect(value("data", "1", "B", "bit")).toBe("8");
  });

  it("converts temperatures through kelvin", () => {
    expect(value("temperature", "100", "c", "f")).toBe("212");
    expect(value("temperature", "-40", "f", "c")).toBe("-40");
    expect(value("temperature", "98.6", "f", "c")).toBe("37");
    expect(value("temperature", "0", "k", "c")).toBe("-273.15");
    expect(value("temperature", "0", "c", "k")).toBe("273.15");
  });

  it("shows 0.1 + 0.2 style values with no noise", () => {
    expect(value("length", "0.3", "m", "mm")).toBe("300");
    expect(value("length", "0.1", "km", "m")).toBe("100");
  });

  it("has a unit list for every kind, with unique ids", () => {
    for (const group of GROUPS) {
      const ids = UNITS[group].map((unit) => unit.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeGreaterThan(1);
    }
  });
});

describe("limits and errors", () => {
  it("accepts exactly 1,000,000,000,000,000 and refuses one more", () => {
    expect(value("length", "1000000000000000", "km", "m")).toBe("1,000,000,000,000,000,000");
    expect(convert("length", "1000000000000001", "km", "m")).toMatchObject({ ok: false });
    expect(convert("length", "-1000000000000000.1", "km", "m")).toMatchObject({ ok: false });
  });

  it("accepts 15 decimal places and refuses 16", () => {
    expect(convert("length", "0.000000000000001", "m", "mm")).toMatchObject({
      ok: true,
      value: "0.000000000001",
    });
    expect(convert("length", "0.0000000000000001", "m", "mm")).toEqual({
      ok: false,
      error: "Use at most 15 digits after the decimal point.",
    });
  });

  it("refuses an empty value, text and a temperature below absolute zero", () => {
    expect(convert("length", " ", "m", "km")).toEqual({
      ok: false,
      error: "Enter a value to convert.",
    });
    expect(convert("length", "abc", "m", "km")).toMatchObject({ ok: false });
    expect(convert("length", "1/2", "m", "km")).toMatchObject({ ok: false });
    expect(convert("temperature", "-273.16", "c", "k")).toMatchObject({ ok: false });
    expect(convert("temperature", "-273.15", "c", "k")).toMatchObject({ ok: true, value: "0" });
  });

  it("refuses units of another kind", () => {
    expect(convert("length", "1", "kg", "m")).toMatchObject({ ok: false });
  });
});
