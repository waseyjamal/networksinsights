import { describe, expect, it } from "vitest";
import {
  checkFile,
  imageTypeOf,
  LIMITS,
  MAX_SIDE,
  MESSAGES,
  outputName,
  outputType,
  parseNumber,
  qualityFor,
  targetSize,
  withinPixelLimit,
} from "./logic";

const original = { width: 1200, height: 800 };
const pixels = (width?: number, height?: number, keepRatio = true) =>
  targetSize({ mode: "pixels", width, height, keepRatio }, original);
const percent = (value?: number) =>
  targetSize({ mode: "percent", percent: value, keepRatio: true }, original);

describe("targetSize in pixels", () => {
  it("keeps proportions from either side", () => {
    expect(pixels(600)).toEqual({ ok: true, size: { width: 600, height: 400 } });
    expect(pixels(undefined, 200)).toEqual({ ok: true, size: { width: 300, height: 200 } });
    // A side that rounds to zero is still one pixel.
    expect(pixels(1)).toEqual({ ok: true, size: { width: 1, height: 1 } });
  });

  it("takes both sides as given with proportions off", () => {
    expect(pixels(500, 500, false)).toEqual({ ok: true, size: { width: 500, height: 500 } });
    expect(pixels(500, undefined, false)).toEqual({ ok: false, error: MESSAGES.needBoth });
  });

  it("refuses empty, fractional, zero and negative sizes", () => {
    expect(pixels()).toEqual({ ok: false, error: MESSAGES.needSize });
    expect(pixels(10.5)).toEqual({ ok: false, error: MESSAGES.wholePixels });
    expect(pixels(0)).toEqual({ ok: false, error: MESSAGES.wholePixels });
    expect(pixels(-5)).toEqual({ ok: false, error: MESSAGES.wholePixels });
  });

  it("refuses more than 16,384 pixels a side or 50 megapixels, and takes the edge", () => {
    expect(pixels(MAX_SIDE, 1, false)).toEqual({ ok: true, size: { width: MAX_SIDE, height: 1 } });
    expect(pixels(MAX_SIDE + 1, 1, false)).toEqual({ ok: false, error: MESSAGES.tooBig });
    expect(pixels(10_000, 5_000, false).ok).toBe(true);
    expect(pixels(10_000, 5_001, false)).toEqual({ ok: false, error: MESSAGES.tooBig });
  });
});

describe("targetSize in percent", () => {
  it("scales both sides and rounds", () => {
    expect(percent(50)).toEqual({ ok: true, size: { width: 600, height: 400 } });
    expect(percent(33)).toEqual({ ok: true, size: { width: 396, height: 264 } });
    expect(percent(1)).toEqual({ ok: true, size: { width: 12, height: 8 } });
  });

  it("refuses a percentage outside 1 to 1000", () => {
    expect(percent(0)).toEqual({ ok: false, error: MESSAGES.percentRange });
    expect(percent(1001)).toEqual({ ok: false, error: MESSAGES.percentRange });
    expect(percent(undefined)).toEqual({ ok: false, error: MESSAGES.percentRange });
    expect(
      targetSize({ mode: "percent", percent: 1000, keepRatio: true }, { width: 100, height: 80 }),
    ).toEqual({ ok: true, size: { width: 1000, height: 800 } });
    // 1000% of 1,200 by 800 would be 96 megapixels.
    expect(percent(1000)).toEqual({ ok: false, error: MESSAGES.tooBig });
  });
});

describe("files and formats", () => {
  it("checks the type and the size limit", () => {
    expect(checkFile({ name: "a.png", type: "image/png", size: LIMITS.maxInputBytes })).toBe(
      undefined,
    );
    expect(checkFile({ name: "a.png", type: "image/png", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooLarge("25 MB"),
    );
    expect(checkFile({ name: "a.gif", type: "image/gif", size: 1 })).toBe(MESSAGES.notAnImage);
    expect(imageTypeOf({ name: "a.jpeg", type: "" })).toBe("image/jpeg");
  });

  it("keeps the format, or writes PNG where WebP cannot be written", () => {
    const all = ["image/jpeg", "image/png", "image/webp"] as const;
    expect(outputType("image/webp", all)).toBe("image/webp");
    expect(outputType("image/webp", ["image/jpeg", "image/png"])).toBe("image/png");
    expect(outputType("image/jpeg", all)).toBe("image/jpeg");
    expect(qualityFor("image/png")).toBeUndefined();
    expect(qualityFor("image/jpeg")).toBe(0.92);
  });

  it("names the result with its size", () => {
    expect(outputName("photo.jpg", { width: 800, height: 600 }, "image/jpeg")).toBe(
      "photo-800x600.jpg",
    );
    expect(outputName("photo.webp", { width: 8, height: 6 }, "image/png")).toBe("photo-8x6.png");
  });

  it("reads number boxes and the pixel limit", () => {
    expect(parseNumber(" 42 ")).toBe(42);
    expect(parseNumber("")).toBeUndefined();
    expect(parseNumber("abc")).toBeUndefined();
    expect(withinPixelLimit(10_000, 5_000)).toBe(true);
    expect(withinPixelLimit(10_000, 5_001)).toBe(false);
  });
});
