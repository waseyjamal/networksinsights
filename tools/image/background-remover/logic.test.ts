import { describe, expect, it } from "vitest";
import {
  applyMask,
  checkFiles,
  downloadSize,
  formatSize,
  inputTypeOf,
  LIMITS,
  MESSAGES,
  MODEL_SIZE,
  maskToRgba,
  outputName,
  percentOf,
  toTensor,
  withinPixelLimit,
} from "./logic";

const file = (name: string, type: string, size = 1000) => ({ name, type, size });

describe("checkFiles", () => {
  it("takes one JPG, PNG or WebP photo", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(checkFiles([file("a", type)]).file).toBeDefined();
    }
  });

  it("knows a photo by its extension when the browser gives no type", () => {
    expect(inputTypeOf(file("cat.JPEG", ""))).toBe("image/jpeg");
    expect(inputTypeOf(file("cat.webp", ""))).toBe("image/webp");
    expect(inputTypeOf(file("cat.gif", ""))).toBeUndefined();
  });

  it("refuses other types, more than one photo, and photos over 20 MB", () => {
    expect(checkFiles([file("a.gif", "image/gif")]).error).toBe(MESSAGES.notAnImage);
    expect(checkFiles([file("a.png", "image/png"), file("b.png", "image/png")]).error).toBe(
      MESSAGES.oneAtATime,
    );
    expect(checkFiles([file("a.png", "image/png", LIMITS.maxInputBytes + 1)]).error).toBe(
      MESSAGES.tooLarge("20 MB"),
    );
    expect(checkFiles([file("a.png", "image/png", LIMITS.maxInputBytes)]).file).toBeDefined();
    expect(checkFiles([]).error).toBe(MESSAGES.notAnImage);
  });
});

describe("withinPixelLimit", () => {
  it("allows up to 25 megapixels", () => {
    expect(withinPixelLimit(5000, 5000)).toBe(true);
    expect(withinPixelLimit(5000, 5001)).toBe(false);
    expect(withinPixelLimit(0, 10)).toBe(false);
  });
});

describe("outputName", () => {
  it("names the result as a PNG", () => {
    expect(outputName("dog.jpg")).toBe("dog-no-background.png");
    expect(outputName("holiday photo.webp")).toBe("holiday photo-no-background.png");
  });
});

describe("toTensor", () => {
  it("writes three normalised planes, scaled by the brightest value", () => {
    const tensor = toTensor([255, 255, 255, 255], 1);
    expect(tensor).toHaveLength(3);
    expect(tensor[0]).toBeCloseTo((1 - 0.485) / 0.229);
    expect(tensor[1]).toBeCloseTo((1 - 0.456) / 0.224);
    expect(tensor[2]).toBeCloseTo((1 - 0.406) / 0.225);
  });

  it("ignores alpha when it finds the brightest value", () => {
    const tensor = toTensor([100, 50, 0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0], 2);
    expect(tensor[0]).toBeCloseTo((1 - 0.485) / 0.229);
    expect(tensor[4]).toBeCloseTo((0.5 - 0.456) / 0.224);
  });

  it("refuses pixels of the wrong size", () => {
    expect(() => toTensor([0, 0, 0, 0], MODEL_SIZE)).toThrow(RangeError);
  });
});

describe("maskToRgba and applyMask", () => {
  it("stretches the prediction to 0–255 grey", () => {
    expect([...maskToRgba([0, 0.5, 1])]).toEqual([
      0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255,
    ]);
    expect([...maskToRgba([0.5])]).toEqual([0, 0, 0, 255]);
  });

  it("puts the mask in the alpha channel, never making a pixel more opaque", () => {
    const photo = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 100]);
    applyMask(photo, [0, 0, 0, 255, 200, 200, 200, 255]);
    expect([...photo]).toEqual([10, 20, 30, 0, 40, 50, 60, 100]);
    expect(() => applyMask(photo, [0])).toThrow(RangeError);
  });
});

describe("formatSize and percentOf", () => {
  it("reads like a person writes", () => {
    expect(downloadSize()).toBe("18 MB");
    expect(formatSize(LIMITS.maxInputBytes)).toBe("20 MB");
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(9, 4)).toBe(100);
  });
});
