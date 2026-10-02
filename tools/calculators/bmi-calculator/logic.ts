// Pure logic of BMI Calculator: body mass index (weight in kilograms divided by the square of the
// height in metres) for an adult, in metric or imperial units, with the adult categories of the
// World Health Organization: below 18.5, 18.5 to 24.9, 25.0 to 29.9 and 30.0 or more.

export type System = "metric" | "imperial";

export type Category = "underweight" | "normal" | "overweight" | "obesity";

export const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  underweight: "Underweight",
  normal: "Normal weight",
  overweight: "Overweight (pre-obesity)",
  obesity: "Obesity",
};

/** The limits of what is accepted, checked in centimetres and kilograms. */
export const MIN_HEIGHT_CM = 50;
export const MAX_HEIGHT_CM = 300;
export const MIN_WEIGHT_KG = 10;
export const MAX_WEIGHT_KG = 650;

/** Exact definitions of the imperial units. */
export const CM_PER_INCH = 2.54;
export const KG_PER_POUND = 0.45359237;
export const INCHES_PER_FOOT = 12;

/** The WHO cut-offs, in kg/m². The two ends of the normal range as WHO writes them. */
export const NORMAL_MIN = 18.5;
export const NORMAL_MAX = 24.9;

/** What the tool accepts, as typed. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  system: System;
  /** Metric height in centimetres. */
  cm: string;
  /** Imperial height: whole feet and the inches on top. An empty inches box counts as 0. */
  feet: string;
  inches: string;
  /** Kilograms for metric, pounds for imperial. */
  weight: string;
}

export type Field = "cm" | "feet" | "inches" | "weight";

export type Result =
  | {
      ok: true;
      /** The index, rounded to one decimal, which is how it is shown and how it is classified. */
      bmi: number;
      category: Category;
      /** The weights, in the unit the visitor used, that give a BMI of 18.5 and of 24.9. */
      normalFrom: number;
      normalTo: number;
    }
  | { ok: false; field: Field; error: string };

/** Reads a number: an optional sign, digits and an optional decimal point. Null when it is not one. */
export function parseNumber(text: string): number | null {
  const t = text.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const value = Number(t);
  return Number.isFinite(value) ? value : null;
}

/** The adult category of a BMI that has been rounded to one decimal. */
export function categoryOf(bmi: number): Category {
  if (bmi < NORMAL_MIN) return "underweight";
  if (bmi <= NORMAL_MAX) return "normal";
  if (bmi < 30) return "overweight";
  return "obesity";
}

const LABELS: Readonly<Record<Field, string>> = {
  cm: "the height",
  feet: "the feet",
  inches: "the inches",
  weight: "the weight",
};

function read(text: string, field: Field): number | Result {
  if (text.trim() === "") return { ok: false, field, error: `Enter ${LABELS[field]}.` };
  const value = parseNumber(text);
  if (value === null) {
    return {
      ok: false,
      field,
      error: `${LABELS[field].replace(/^./, (c) => c.toUpperCase())} is not a number. Use digits, with a decimal point if needed.`,
    };
  }
  return value;
}

/** The body mass index of an adult, its WHO category, and the weights of the normal range. */
export function run(input: Input): Result {
  let heightCm: number;
  if (input.system === "metric") {
    const cm = read(input.cm, "cm");
    if (typeof cm !== "number") return cm;
    heightCm = cm;
  } else {
    const feet = read(input.feet, "feet");
    if (typeof feet !== "number") return feet;
    let inches = 0;
    if (input.inches.trim() !== "") {
      const parsed = read(input.inches, "inches");
      if (typeof parsed !== "number") return parsed;
      inches = parsed;
    }
    if (feet < 0) return { ok: false, field: "feet", error: "The feet cannot be negative." };
    if (inches < 0 || inches >= INCHES_PER_FOOT) {
      return {
        ok: false,
        field: "inches",
        error: "The inches must be from 0 up to, but not including, 12.",
      };
    }
    heightCm = (feet * INCHES_PER_FOOT + inches) * CM_PER_INCH;
  }
  const weight = read(input.weight, "weight");
  if (typeof weight !== "number") return weight;
  const weightKg = input.system === "metric" ? weight : weight * KG_PER_POUND;

  const heightField: Field = input.system === "metric" ? "cm" : "feet";
  if (heightCm < MIN_HEIGHT_CM || heightCm > MAX_HEIGHT_CM) {
    return {
      ok: false,
      field: heightField,
      error: `The height must be from ${MIN_HEIGHT_CM} to ${MAX_HEIGHT_CM} centimetres (or the same in feet and inches).`,
    };
  }
  if (weightKg < MIN_WEIGHT_KG || weightKg > MAX_WEIGHT_KG) {
    return {
      ok: false,
      field: "weight",
      error: `The weight must be from ${MIN_WEIGHT_KG} to ${MAX_WEIGHT_KG} kilograms (or the same in pounds).`,
    };
  }

  const metres = heightCm / 100;
  const bmi = Math.round((weightKg / (metres * metres)) * 10) / 10;
  const scale = input.system === "metric" ? 1 : 1 / KG_PER_POUND;
  return {
    ok: true,
    bmi,
    category: categoryOf(bmi),
    normalFrom: NORMAL_MIN * metres * metres * scale,
    normalTo: NORMAL_MAX * metres * metres * scale,
  };
}
