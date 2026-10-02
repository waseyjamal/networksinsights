import { describe, expect, it } from "vitest";
import {
  categoryOf,
  type Input,
  MAX_HEIGHT_CM,
  MAX_WEIGHT_KG,
  MIN_HEIGHT_CM,
  MIN_WEIGHT_KG,
  parseNumber,
  run,
} from "./logic";

const metric = (cm: string, weight: string) =>
  run({ system: "metric", cm, feet: "", inches: "", weight });
const imperial = (feet: string, inches: string, weight: string) =>
  run({ system: "imperial", cm: "", feet, inches, weight } satisfies Input);

describe("parseNumber", () => {
  it("reads plain numbers and refuses the rest", () => {
    expect(parseNumber(" 175.5 ")).toBe(175.5);
    expect(parseNumber(".5")).toBe(0.5);
    expect(parseNumber("1,75")).toBeNull();
    expect(parseNumber("1e2")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });
});

describe("categoryOf", () => {
  it("uses the WHO cut-offs at their edges", () => {
    expect(categoryOf(18.4)).toBe("underweight");
    expect(categoryOf(18.5)).toBe("normal");
    expect(categoryOf(24.9)).toBe("normal");
    expect(categoryOf(25.0)).toBe("overweight");
    expect(categoryOf(29.9)).toBe("overweight");
    expect(categoryOf(30.0)).toBe("obesity");
    expect(categoryOf(45)).toBe("obesity");
  });
});

describe("metric", () => {
  it("answers the example of its page", () => {
    const result = metric("175", "70");
    if (!result.ok) throw new Error(result.error);
    expect(result.bmi).toBe(22.9);
    expect(result.category).toBe("normal");
    expect(result.normalFrom).toBeCloseTo(56.66, 1);
    expect(result.normalTo).toBeCloseTo(76.26, 1);
  });

  it("classifies each band", () => {
    expect(metric("170", "50")).toMatchObject({ bmi: 17.3, category: "underweight" });
    expect(metric("170", "80")).toMatchObject({ bmi: 27.7, category: "overweight" });
    expect(metric("170", "95")).toMatchObject({ bmi: 32.9, category: "obesity" });
  });

  it("classifies on the BMI as shown, rounded to one decimal", () => {
    // 100 cm and 24.96 kg is 24.96, which is shown, and classified, as 25.0.
    expect(metric("100", "24.96")).toMatchObject({ bmi: 25, category: "overweight" });
    expect(metric("100", "24.94")).toMatchObject({ bmi: 24.9, category: "normal" });
    expect(metric("100", "18.46")).toMatchObject({ bmi: 18.5, category: "normal" });
  });

  it("accepts the limits themselves", () => {
    expect(metric(String(MIN_HEIGHT_CM), String(MIN_WEIGHT_KG))).toMatchObject({ ok: true });
    expect(metric(String(MAX_HEIGHT_CM), String(MAX_WEIGHT_KG))).toMatchObject({ ok: true });
  });
});

describe("imperial", () => {
  it("converts feet, inches and pounds exactly", () => {
    // 5 ft 9 in is 175.26 cm; 154 lb is 69.853 kg.
    const result = imperial("5", "9", "154");
    if (!result.ok) throw new Error(result.error);
    expect(result.bmi).toBe(22.7);
    expect(result.category).toBe("normal");
    // The normal range comes back in pounds.
    expect(result.normalFrom).toBeCloseTo(125.4, 0);
    expect(result.normalTo).toBeCloseTo(168.8, 0);
  });

  it("treats an empty inches box as 0", () => {
    expect(imperial("6", "", "180")).toEqual(imperial("6", "0", "180"));
  });

  it("agrees with the metric answer for the same body", () => {
    // 180 lb is 81.6466 kg and 6 ft is 182.88 cm.
    expect(imperial("6", "0", "180")).toMatchObject({ bmi: 24.4 });
    expect(metric("182.88", "81.6466")).toMatchObject({ bmi: 24.4 });
  });
});

describe("errors", () => {
  it("names the empty box", () => {
    expect(metric("", "70")).toEqual({ ok: false, field: "cm", error: "Enter the height." });
    expect(metric("175", "")).toEqual({ ok: false, field: "weight", error: "Enter the weight." });
    expect(imperial("", "9", "150")).toEqual({
      ok: false,
      field: "feet",
      error: "Enter the feet.",
    });
  });

  it("explains an unreadable number", () => {
    const result = metric("tall", "70");
    expect(!result.ok && result.field).toBe("cm");
    expect(!result.ok && result.error).toContain("is not a number");
  });

  it("refuses a height or weight outside the limits", () => {
    expect(metric("49.9", "70")).toMatchObject({ ok: false, field: "cm" });
    expect(metric("300.1", "70")).toMatchObject({ ok: false, field: "cm" });
    expect(metric("175", "9.9")).toMatchObject({ ok: false, field: "weight" });
    expect(metric("175", "650.1")).toMatchObject({ ok: false, field: "weight" });
    expect(metric("175", "0")).toMatchObject({ ok: false, field: "weight" });
    expect(metric("-175", "70")).toMatchObject({ ok: false, field: "cm" });
    expect(imperial("0", "5", "150")).toMatchObject({ ok: false, field: "feet" });
    expect(imperial("5", "9", "20000")).toMatchObject({ ok: false, field: "weight" });
  });

  it("refuses inches of 12 or more and negative feet or inches", () => {
    expect(imperial("5", "12", "150")).toMatchObject({ ok: false, field: "inches" });
    expect(imperial("5", "-1", "150")).toMatchObject({ ok: false, field: "inches" });
    expect(imperial("-5", "0", "150")).toMatchObject({ ok: false, field: "feet" });
    expect(imperial("5", "11.9", "150")).toMatchObject({ ok: true });
  });
});
