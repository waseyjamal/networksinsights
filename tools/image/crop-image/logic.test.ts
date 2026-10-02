import { describe, expect, it } from "vitest";
import {
  checkCrop,
  checkFile,
  heightFor,
  LIMITS,
  largestCrop,
  MESSAGES,
  outputName,
  outputType,
  parseNumber,
  widthFor,
} from "./logic";

const image = { width: 1200, height: 800 };

describe("largestCrop", () => {
  it("takes the whole picture when free", () => {
    expect(largestCrop(image, "free")).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
  });

  it("centres the largest crop of a ratio", () => {
    expect(largestCrop(image, "1:1")).toEqual({ x: 200, y: 0, width: 800, height: 800 });
    expect(largestCrop(image, "16:9")).toEqual({ x: 0, y: 62, width: 1200, height: 675 });
    expect(largestCrop(image, "9:16")).toEqual({ x: 375, y: 0, width: 450, height: 800 });
    expect(largestCrop(image, "3:2")).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
  });

  it("never gives less than one pixel, even for a sliver", () => {
    const crop = largestCrop({ width: 1, height: 100 }, "16:9");
    expect(crop.width).toBe(1);
    expect(crop.height).toBe(1);
  });
});

describe("ratios", () => {
  it("links width and height for a fixed shape, and not when free", () => {
    expect(heightFor(400, "4:3")).toBe(300);
    expect(widthFor(300, "4:3")).toBe(400);
    expect(heightFor(400, "free")).toBeUndefined();
    expect(widthFor(400, "free")).toBeUndefined();
  });
});

describe("checkCrop", () => {
  it("takes a rectangle inside the picture, edges included", () => {
    expect(checkCrop({ x: 0, y: 0, width: 1200, height: 800 }, image).ok).toBe(true);
    expect(checkCrop({ x: 1199, y: 799, width: 1, height: 1 }, image).ok).toBe(true);
  });

  it("refuses a rectangle that leaves the picture", () => {
    expect(checkCrop({ x: 1, y: 0, width: 1200, height: 800 }, image)).toEqual({
      ok: false,
      error: MESSAGES.outside(image),
    });
    expect(checkCrop({ x: 0, y: 700, width: 10, height: 101 }, image).ok).toBe(false);
  });

  it("refuses empty, negative, zero and fractional numbers", () => {
    const whole = { ok: false, error: MESSAGES.wholePixels };
    expect(checkCrop({ x: 0, y: 0, width: 10 }, image)).toEqual(whole);
    expect(checkCrop({ x: -1, y: 0, width: 10, height: 10 }, image)).toEqual(whole);
    expect(checkCrop({ x: 0, y: 0, width: 0, height: 10 }, image)).toEqual(whole);
    expect(checkCrop({ x: 0.5, y: 0, width: 10, height: 10 }, image)).toEqual(whole);
  });
});

describe("files, names and formats", () => {
  it("checks the type and the 25 MB limit", () => {
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: LIMITS.maxInputBytes })).toBe(
      undefined,
    );
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooLarge("25 MB"),
    );
    expect(checkFile({ name: "a.bmp", type: "image/bmp", size: 1 })).toBe(MESSAGES.notAnImage);
  });

  it("names the result and keeps the format where it can", () => {
    expect(outputName("photo.jpg", { x: 0, y: 0, width: 800, height: 800 }, "image/jpeg")).toBe(
      "photo-cropped-800x800.jpg",
    );
    expect(outputType("image/webp", ["image/jpeg", "image/png"])).toBe("image/png");
    expect(parseNumber("12")).toBe(12);
    expect(parseNumber(" ")).toBeUndefined();
  });
});
