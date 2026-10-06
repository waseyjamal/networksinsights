import { describe, expect, it } from "vitest";
import {
  applyAlpha,
  checkFile,
  checkPixels,
  isOutOfMemory,
  LIMITS,
  MESSAGES,
  MODEL_STEP,
  modelSize,
  modelTensor,
  outputName,
  scaleMatte,
} from "./logic";

describe("the size the model sees", () => {
  it("puts the shorter side at 512 and rounds both down to a multiple of 32", () => {
    expect(modelSize(512, 640)).toEqual({ width: 512, height: 640 });
    expect(modelSize(4000, 3000)).toEqual({ width: 672, height: 512 });
    expect(modelSize(3000, 4000)).toEqual({ width: 512, height: 672 });
    expect(modelSize(100, 50)).toEqual({ width: 1024, height: 512 });
    expect(modelSize(1080, 1080)).toEqual({ width: 512, height: 512 });
  });

  it("keeps a very long strip within 2048 pixels, and no side under 32", () => {
    expect(modelSize(20_000, 10)).toEqual({ width: 2048, height: 32 });
    expect(modelSize(10, 20_000)).toEqual({ width: 32, height: 2048 });
    expect(modelSize(4000, 1000)).toEqual({ width: 2048, height: 512 });
    const size = modelSize(5000, 1000);
    expect(size).toEqual({ width: 2048, height: 384 });
    expect(size.height % MODEL_STEP).toBe(0);
  });
});

describe("the tensors", () => {
  it("gives the model RGB planes from -1 to 1", () => {
    const rgba = new Uint8ClampedArray([0, 255, 0, 255, 255, 0, 255, 0]);
    const tensor = modelTensor(rgba, 2, 1);
    expect(Array.from(tensor)).toEqual([-1, 1, 1, -1, -1, 1]);
  });

  it("keeps a matte of the same size exactly", () => {
    const matte = new Float32Array([0, 0.5, 1, 0.25]);
    expect(Array.from(scaleMatte(matte, 2, 2, 2, 2))).toEqual([0, 128, 255, 64]);
  });

  it("scales a matte up with bilinear sampling, pixel centres aligned", () => {
    const matte = new Float32Array([0, 1]);
    // Doubling a 0 to 1 step: the outer pixels keep their value, the inner ones blend 1/4 and 3/4.
    expect(Array.from(scaleMatte(matte, 2, 1, 4, 1))).toEqual([0, 64, 191, 255]);
  });

  it("keeps a flat matte flat at any size", () => {
    const matte = new Float32Array(32 * 32).fill(0.6);
    const alpha = scaleMatte(matte, 32, 32, 101, 57);
    expect(alpha.length).toBe(101 * 57);
    expect(alpha.every((value) => value === 153)).toBe(true);
  });

  it("multiplies the matte into the picture's own alpha", () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 128, 1, 2, 3, 255]);
    applyAlpha(rgba, new Uint8ClampedArray([255, 255, 0]));
    expect(Array.from(rgba)).toEqual([10, 20, 30, 255, 10, 20, 30, 128, 1, 2, 3, 0]);
  });
});

describe("the limits", () => {
  const file = (name: string, type: string, size = 1000) => ({ name, type, size });

  it("takes JPG, PNG and WebP up to 30 MB", () => {
    expect(checkFile(file("me.jpg", "image/jpeg"))).toBeNull();
    expect(checkFile(file("me.webp", ""))).toBeNull();
    expect(checkFile(file("me.heic", "image/heic"))).toBe(MESSAGES.notImage);
    expect(checkFile(file("me.png", "image/png", LIMITS.maxInputBytes))).toBeNull();
    expect(checkFile(file("me.png", "image/png", LIMITS.maxInputBytes + 1))).toBe(
      MESSAGES.tooLarge("30 MB"),
    );
  });

  it("takes 24 megapixels and refuses one pixel row more", () => {
    expect(checkPixels(6000, 4000)).toBeNull();
    expect(checkPixels(6000, 4001)).toBe(MESSAGES.tooManyPixels(6000, 4001));
    expect(checkPixels(0, 4000)).toBe(MESSAGES.unreadable);
  });

  it("knows an allocation failure from any other failure", () => {
    expect(isOutOfMemory(new RangeError("Invalid typed array length: 4294967296"))).toBe(true);
    expect(isOutOfMemory(new Error("Aborted(OOM)"))).toBe(true);
    expect(isOutOfMemory(new Error("Got invalid dimensions for input"))).toBe(false);
  });

  it("names the result after the picture", () => {
    expect(outputName("me.jpg")).toBe("me-no-background.png");
  });
});
