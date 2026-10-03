import { describe, expect, it } from "vitest";
import { MAX, run, type Style, type System, wholeToWords } from "./logic";

const words = (text: string, system: System = "indian", style: Style = "words") => {
  const result = run({ text, system, style });
  if (!result.ok) throw new Error(result.error);
  return result.words;
};

describe("wholeToWords", () => {
  it("writes small numbers", () => {
    expect(wholeToWords(0n, "indian")).toBe("zero");
    expect(wholeToWords(7n, "indian")).toBe("seven");
    expect(wholeToWords(15n, "indian")).toBe("fifteen");
    expect(wholeToWords(40n, "indian")).toBe("forty");
    expect(wholeToWords(99n, "indian")).toBe("ninety-nine");
    expect(wholeToWords(100n, "indian")).toBe("one hundred");
    expect(wholeToWords(101n, "indian")).toBe("one hundred one");
  });

  it("uses lakh and crore in the Indian system", () => {
    expect(wholeToWords(100000n, "indian")).toBe("one lakh");
    expect(wholeToWords(10000000n, "indian")).toBe("one crore");
    expect(wholeToWords(1000000000000n, "indian")).toBe("one lakh crore");
  });

  it("uses million, billion and trillion in the international system", () => {
    expect(wholeToWords(1000000n, "international")).toBe("one million");
    expect(wholeToWords(1000000000n, "international")).toBe("one billion");
    expect(wholeToWords(1000000000000n, "international")).toBe("one trillion");
  });
});

describe("run", () => {
  it("answers the example of its page", () => {
    expect(words("1234567")).toBe("Twelve lakh thirty-four thousand five hundred sixty-seven");
    expect(words("12,34,567", "international")).toBe(
      "One million two hundred thirty-four thousand five hundred sixty-seven",
    );
    expect(words("1250.50", "indian", "rupees")).toBe(
      "Rupees one thousand two hundred fifty and fifty paise only",
    );
    expect(words("1250.5", "international", "dollars")).toBe(
      "One thousand two hundred fifty dollars and fifty cents",
    );
  });

  it("handles negatives and decimals", () => {
    expect(words("-42")).toBe("Minus forty-two");
    expect(words("3.14")).toBe("Three point one four");
    expect(words("0.05")).toBe("Zero point zero five");
    expect(words("-0")).toBe("Zero");
  });

  it("uses the singular for one dollar and one cent", () => {
    expect(words("1.01", "international", "dollars")).toBe("One dollar and one cent");
    expect(words("2", "international", "dollars")).toBe("Two dollars");
    expect(words("0", "indian", "rupees")).toBe("Rupees zero only");
  });

  it("writes the largest supported number exactly", () => {
    expect(words(MAX.toString(), "international")).toBe(
      "Nine hundred ninety-nine trillion nine hundred ninety-nine billion nine hundred ninety-nine million nine hundred ninety-nine thousand nine hundred ninety-nine",
    );
    expect(words("999999999999999")).toBe(
      "Nine crore ninety-nine lakh ninety-nine thousand nine hundred ninety-nine crore ninety-nine lakh ninety-nine thousand nine hundred ninety-nine",
    );
    expect(words("-999999999999999.9999999999")).toMatch(/^Minus nine/);
  });

  it("refuses one past the largest supported number", () => {
    expect(run({ text: "1000000000000000", system: "indian", style: "words" })).toEqual({
      ok: false,
      error: "The number is too large; the largest supported is 999,999,999,999,999.",
    });
  });

  it("refuses 11 decimals in words and 3 in money", () => {
    expect(run({ text: "0.12345678901", system: "indian", style: "words" })).toMatchObject({
      ok: false,
    });
    expect(run({ text: "1.005", system: "indian", style: "rupees" })).toMatchObject({ ok: false });
    expect(words("1.99", "indian", "rupees")).toBe("Rupees one and ninety-nine paise only");
  });

  it("refuses a negative cheque, text and bad commas", () => {
    expect(run({ text: "-5", system: "indian", style: "rupees" })).toEqual({
      ok: false,
      error: "A cheque amount cannot be negative.",
    });
    expect(run({ text: "", system: "indian", style: "words" })).toMatchObject({ ok: false });
    expect(run({ text: "12a", system: "indian", style: "words" })).toMatchObject({ ok: false });
    expect(run({ text: "1,,000", system: "indian", style: "words" })).toMatchObject({ ok: false });
    expect(run({ text: "1e5", system: "indian", style: "words" })).toMatchObject({ ok: false });
  });
});
