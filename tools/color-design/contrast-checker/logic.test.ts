import { describe, expect, it } from "vitest";
import { CRITERIA, contrastRatio, formatHex, formatRatio, luminance, parseHex, run } from "./logic";

const check = (foreground: string, background: string) => run({ foreground, background });

function ok(result: ReturnType<typeof run>) {
  if (!result.ok) throw new Error(result.error);
  return result;
}

const verdicts = (result: ReturnType<typeof run>) =>
  ok(result)
    .checks.map((c) => `${c.id}:${c.passes ? "pass" : "fail"}`)
    .join(" ");

describe("parseHex", () => {
  it("reads 3 and 6 digits, with or without the #, in either case", () => {
    expect(parseHex("#767676", "foreground")).toEqual({ r: 118, g: 118, b: 118 });
    expect(parseHex("FFF", "foreground")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex(" #f80 ", "background")).toEqual({ r: 255, g: 136, b: 0 });
    expect(parseHex("#AbCdEf", "background")).toEqual({ r: 171, g: 205, b: 239 });
  });

  it("explains what is wrong, naming the color", () => {
    expect(parseHex("", "foreground")).toBe("Enter the text color as a HEX code, such as #767676.");
    expect(parseHex("#", "background")).toBe(
      "Enter the background color as a HEX code, such as #767676.",
    );
    expect(parseHex("#12345", "foreground")).toBe(
      "The text color needs 3 or 6 digits after the #, such as #767676; this has 5.",
    );
    expect(parseHex("#12", "foreground")).toContain("this has 2");
    expect(parseHex("#12345g", "background")).toContain("only the digits 0 to 9");
    expect(parseHex("rgb(1,2,3)", "background")).toContain("only the digits 0 to 9");
  });

  it("refuses transparency, as the color converter does", () => {
    expect(parseHex("#fff8", "foreground")).toBe(
      "The text color has transparency (4 or 8 digits), which is not supported. Use 3 or 6 digits.",
    );
    expect(parseHex("#ffffff80", "background")).toContain("transparency");
  });
});

describe("luminance and ratio", () => {
  it("is 0 for black and 1 for white", () => {
    expect(luminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(luminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 12);
  });

  it("weights the channels as WCAG does", () => {
    expect(luminance({ r: 255, g: 0, b: 0 })).toBeCloseTo(0.2126, 6);
    expect(luminance({ r: 0, g: 255, b: 0 })).toBeCloseTo(0.7152, 6);
    expect(luminance({ r: 0, g: 0, b: 255 })).toBeCloseTo(0.0722, 6);
  });

  it("uses the linear part below 0.04045", () => {
    // 10/255 is 0.0392, under the threshold: 0.0392 / 12.92.
    expect(luminance({ r: 10, g: 10, b: 10 })).toBeCloseTo(10 / 255 / 12.92, 9);
  });

  it("is 21 for black on white, 1 for a color on itself, and the same both ways", () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };
    expect(contrastRatio(black, white)).toBeCloseTo(21, 9);
    expect(contrastRatio(white, black)).toBe(contrastRatio(black, white));
    expect(contrastRatio(white, white)).toBe(1);
  });
});

describe("formatRatio", () => {
  it("rounds down to two decimals, never up", () => {
    expect(formatRatio(4.499)).toBe("4.49:1");
    expect(formatRatio(4.5)).toBe("4.50:1");
    expect(formatRatio(4.5499999)).toBe("4.54:1");
    expect(formatRatio(21)).toBe("21.00:1");
    expect(formatRatio(1)).toBe("1.00:1");
  });

  it("is not thrown off by floating point noise", () => {
    expect(formatRatio(4.55)).toBe("4.55:1");
    expect(formatRatio(4.55 - 1e-12)).toBe("4.55:1");
    expect(formatRatio(1.1 * 3)).toBe("3.30:1");
  });
});

describe("run", () => {
  it("answers the example of its page", () => {
    const result = ok(check("#767676", "#fff"));
    expect(result.foreground).toBe("#767676");
    expect(result.background).toBe("#ffffff");
    expect(result.shown).toBe("4.54:1");
    expect(result.ratio).toBeCloseTo(4.5422, 4);
    expect(verdicts(result)).toBe(
      "aa-normal:pass aa-large:pass aaa-normal:fail aaa-large:pass ui:pass",
    );
  });

  it("lists the five criteria with their ratios, in order", () => {
    expect(CRITERIA.map((c) => [c.label, c.required])).toEqual([
      ["Normal text, AA", 4.5],
      ["Large text, AA", 3],
      ["Normal text, AAA", 7],
      ["Large text, AAA", 4.5],
      ["UI components and graphics, AA", 3],
    ]);
  });

  it("passes everything for black on white and nothing for white on white", () => {
    expect(verdicts(check("#000", "#fff"))).toBe(
      "aa-normal:pass aa-large:pass aaa-normal:pass aaa-large:pass ui:pass",
    );
    expect(verdicts(check("#fff", "#fff"))).toBe(
      "aa-normal:fail aa-large:fail aaa-normal:fail aaa-large:fail ui:fail",
    );
  });

  it("does not care which color is the text", () => {
    expect(ok(check("#fff", "#767676")).ratio).toBe(ok(check("#767676", "#fff")).ratio);
  });

  it("decides at the thresholds without rounding", () => {
    // #777777 on white is 4.478:1, just under 4.5, and shown as 4.47:1.
    expect(verdicts(check("#777", "#fff"))).toBe(
      "aa-normal:fail aa-large:pass aaa-normal:fail aaa-large:fail ui:pass",
    );
    expect(ok(check("#777", "#fff")).shown).toBe("4.47:1");
    // #595959 on white is 7.0047:1, just over 7.
    expect(verdicts(check("#595959", "#fff"))).toContain("aaa-normal:pass");
    // #949494 is 3.03:1, #959595 is 2.99:1, either side of 3.
    expect(verdicts(check("#949494", "#fff"))).toContain("ui:pass");
    expect(verdicts(check("#959595", "#fff"))).toContain("ui:fail");
    expect(verdicts(check("#959595", "#fff"))).toContain("aa-large:fail");
  });

  it("reports a ratio of exactly a threshold as a pass", () => {
    const exact = ok(check("#000", "#fff"));
    expect(exact.checks.every((c) => exact.ratio >= c.required === c.passes)).toBe(true);
  });

  it("writes the colors back as lowercase six-digit HEX", () => {
    expect(formatHex({ r: 1, g: 2, b: 255 })).toBe("#0102ff");
    const result = ok(check("ABC", "#DEF012"));
    expect([result.foreground, result.background]).toEqual(["#aabbcc", "#def012"]);
  });
});

describe("errors", () => {
  it("names the color that cannot be read, text color first", () => {
    expect(check("", "#fff")).toEqual({
      ok: false,
      field: "foreground",
      error: "Enter the text color as a HEX code, such as #767676.",
    });
    expect(check("#fff", "zzz")).toMatchObject({ ok: false, field: "background" });
    expect(check("nope", "also nope")).toMatchObject({ ok: false, field: "foreground" });
  });
});
