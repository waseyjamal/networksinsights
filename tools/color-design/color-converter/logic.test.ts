import { describe, expect, it } from "vitest";
import {
  formatAll,
  formatHex,
  hslToRgb,
  MAX_LENGTH,
  parseHex,
  parseHsl,
  parseRgb,
  rgbToHsl,
  run,
} from "./logic";

const BLUE = { hex: "#3b82f6", rgb: "rgb(59, 130, 246)", hsl: "hsl(217, 91%, 60%)" };

describe("run", () => {
  it("converts the example of its page from each format", () => {
    expect(run({ format: "hex", text: "#3b82f6" })).toEqual({
      ok: true,
      rgb: { r: 59, g: 130, b: 246 },
      texts: BLUE,
    });
    const fromRgb = run({ format: "rgb", text: "rgb(59, 130, 246)" });
    expect(fromRgb.ok && fromRgb.texts).toEqual(BLUE);
  });

  it("keeps the HSL that was typed and rounds the RGB it gives", () => {
    // hsl(217, 91%, 60%) is rgb(60, 131, 246): HEX and RGB hold whole channels only.
    expect(run({ format: "hsl", text: "hsl(217, 91%, 60%)" })).toEqual({
      ok: true,
      rgb: { r: 60, g: 131, b: 246 },
      texts: { hex: "#3c83f6", rgb: "rgb(60, 131, 246)", hsl: "hsl(217, 91%, 60%)" },
    });
    const decimals = run({ format: "hsl", text: "210.4 50.6 40.2" });
    expect(decimals.ok && decimals.texts.hsl).toBe("hsl(210, 51%, 40%)");
  });

  it("asks for a color when the field is empty or blank", () => {
    expect(run({ format: "hex", text: "" })).toEqual({
      ok: false,
      reason: "empty",
      error: "Enter a HEX color, such as #3b82f6.",
    });
    expect(run({ format: "rgb", text: "   " })).toMatchObject({ ok: false, reason: "empty" });
    expect(run({ format: "hsl", text: "" })).toMatchObject({
      error: "Enter an HSL color, such as hsl(217, 91%, 60%).",
    });
  });

  it("explains invalid input", () => {
    expect(run({ format: "hex", text: "#12345" })).toEqual({
      ok: false,
      reason: "invalid",
      error: "A HEX color has 3 or 6 digits after the #, such as #3b82f6; this has 5.",
    });
    expect(run({ format: "rgb", text: "red" })).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("refuses text longer than a color can be", () => {
    expect(run({ format: "rgb", text: "1".repeat(MAX_LENGTH + 1) })).toEqual({
      ok: false,
      reason: "invalid",
      error: "This is too long to be an RGB color.",
    });
  });
});

describe("parseHex", () => {
  it("reads six digits, with or without #, in either case", () => {
    expect(parseHex("#FF8000")).toEqual({ r: 255, g: 128, b: 0 });
    expect(parseHex("ff8000")).toEqual({ r: 255, g: 128, b: 0 });
  });

  it("doubles each digit of the three-digit form", () => {
    expect(parseHex("#f80")).toEqual({ r: 255, g: 136, b: 0 });
    expect(parseHex("#000")).toEqual({ r: 0, g: 0, b: 0 });
    const short = run({ format: "hex", text: "#f80" });
    expect(short.ok && short.texts).toEqual({
      hex: "#ff8800",
      rgb: "rgb(255, 136, 0)",
      hsl: "hsl(32, 100%, 50%)",
    });
  });

  it("refuses other characters, other lengths and transparency", () => {
    expect(parseHex("#ggg")).toMatch(/only the digits 0 to 9 and the letters a to f/);
    expect(parseHex("#")).toMatch(/only the digits/);
    expect(parseHex("#ff00")).toMatch(/transparency/);
    expect(parseHex("#ff000080")).toMatch(/transparency/);
    expect(parseHex("#1234567")).toMatch(/this has 7/);
  });
});

describe("parseRgb", () => {
  it("reads commas, spaces and the bare numbers", () => {
    const orange = { r: 255, g: 128, b: 0 };
    expect(parseRgb("rgb(255, 128, 0)")).toEqual(orange);
    expect(parseRgb("RGB(255 128 0)")).toEqual(orange);
    expect(parseRgb("255,128,0")).toEqual(orange);
    expect(parseRgb("  255   128   0  ")).toEqual(orange);
  });

  it("rounds decimals to the nearest whole channel", () => {
    expect(parseRgb("rgb(0.4, 127.5, 254.6)")).toEqual({ r: 0, g: 128, b: 255 });
  });

  it("refuses values over 255, negatives, percentages and the wrong count", () => {
    expect(parseRgb("rgb(300, 0, 0)")).toBe("Red is 300; each RGB value must be from 0 to 255.");
    expect(parseRgb("0, 0, 256")).toMatch(/^Blue is 256/);
    expect(parseRgb("-1, 0, 0")).toMatch(/three numbers from 0 to 255/);
    expect(parseRgb("50%, 0, 0")).toMatch(/Percentages are not supported/);
    expect(parseRgb("1, 2")).toMatch(/three numbers/);
    expect(parseRgb("1, 2, 3, 4")).toMatch(/three numbers/);
    expect(parseRgb("rgb(1, 2, 3")).toMatch(/three numbers/);
    expect(parseRgb("rgb()")).toMatch(/three numbers/);
  });
});

describe("parseHsl", () => {
  it("reads commas, spaces, deg and optional percent signs", () => {
    const teal = { h: 180, s: 50, l: 40 };
    expect(parseHsl("hsl(180, 50%, 40%)")).toEqual(teal);
    expect(parseHsl("hsl(180deg 50% 40%)")).toEqual(teal);
    expect(parseHsl("180, 50, 40")).toEqual(teal);
  });

  it("reads a hue of 360 as 0", () => {
    expect(parseHsl("360, 100%, 50%")).toEqual({ h: 0, s: 100, l: 50 });
  });

  it("refuses values out of range and malformed text", () => {
    expect(parseHsl("hsl(361, 50%, 50%)")).toBe(
      "The hue is 361; it must be from 0 to 360 degrees.",
    );
    expect(parseHsl("hsl(0, 101%, 50%)")).toBe("Saturation is 101%; it must be from 0 to 100%.");
    expect(parseHsl("hsl(0, 50%, 120%)")).toBe("Lightness is 120%; it must be from 0 to 100%.");
    expect(parseHsl("hsl(-10, 50%, 50%)")).toMatch(/a hue from 0 to 360/);
    expect(parseHsl("hsl(10, 50%)")).toMatch(/a hue from 0 to 360/);
    expect(parseHsl("blue")).toMatch(/a hue from 0 to 360/);
  });
});

describe("conversions", () => {
  it("gives the primary, secondary and gray colors their known HSL", () => {
    expect(formatAll({ r: 255, g: 0, b: 0 }).hsl).toBe("hsl(0, 100%, 50%)");
    expect(formatAll({ r: 0, g: 255, b: 0 }).hsl).toBe("hsl(120, 100%, 50%)");
    expect(formatAll({ r: 0, g: 0, b: 255 }).hsl).toBe("hsl(240, 100%, 50%)");
    expect(formatAll({ r: 255, g: 0, b: 255 }).hsl).toBe("hsl(300, 100%, 50%)");
    expect(formatAll({ r: 128, g: 128, b: 128 }).hsl).toBe("hsl(0, 0%, 50%)");
    expect(formatAll({ r: 255, g: 255, b: 255 }).hsl).toBe("hsl(0, 0%, 100%)");
    expect(formatAll({ r: 0, g: 0, b: 0 }).hsl).toBe("hsl(0, 0%, 0%)");
  });

  it("gives a hue just under 360 for a red with a little blue", () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 4 }).h).toBeCloseTo(359.06, 2);
  });

  it("turns HSL back into the same RGB for every hue sector", () => {
    for (const rgb of [
      { r: 255, g: 128, b: 0 },
      { r: 128, g: 255, b: 0 },
      { r: 0, g: 255, b: 128 },
      { r: 0, g: 128, b: 255 },
      { r: 128, g: 0, b: 255 },
      { r: 255, g: 0, b: 128 },
      { r: 59, g: 130, b: 246 },
      { r: 17, g: 17, b: 17 },
    ]) {
      expect(hslToRgb(rgbToHsl(rgb))).toEqual(rgb);
    }
  });

  it("writes HEX with two lowercase digits per channel", () => {
    expect(formatHex({ r: 0, g: 10, b: 255 })).toBe("#000aff");
  });
});
