import { describe, expect, it } from "vitest";
import {
  checkFile,
  LIMITS,
  MATRICES,
  MESSAGES,
  simulate,
  simulatePixels,
  toByte,
  toLinear,
  viewSize,
} from "./logic";

describe("files and sizes", () => {
  it("takes JPG, PNG and WebP up to exactly 25 MB", () => {
    expect(checkFile({ name: "a.png", type: "image/png", size: LIMITS.maxInputBytes })).toBeNull();
    expect(checkFile({ name: "a.png", type: "image/png", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooLarge("25 MB"),
    );
    expect(checkFile({ name: "a.gif", type: "image/gif", size: 1 })).toBe(MESSAGES.notAnImage);
  });
  it("draws views at most 1000 pixels on the longer side", () => {
    expect(viewSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(viewSize(4000, 2000)).toEqual({ width: 1000, height: 500 });
  });
});

describe("the published matrices", () => {
  it("hold the values of Machado, Oliveira and Fernandes 2009, severity 1.0", () => {
    expect(MATRICES.protanopia[0]).toEqual([0.152286, 1.052583, -0.204868]);
    expect(MATRICES.deuteranopia[1]).toEqual([0.280085, 0.672501, 0.047413]);
    expect(MATRICES.tritanopia[2]).toEqual([0.004733, 0.691367, 0.3039]);
  });
  it("keep white white and black black: every row adds up to about 1", () => {
    for (const matrix of Object.values(MATRICES)) {
      for (const row of matrix) expect(row[0] + row[1] + row[2]).toBeCloseTo(1, 3);
    }
    expect(simulate("protanopia", [255, 255, 255])).toEqual([255, 255, 255]);
    expect(simulate("tritanopia", [0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe("simulate", () => {
  it("converts sRGB to linear light and back", () => {
    expect(toLinear(255)).toBe(1);
    expect(toByte(toLinear(128))).toBe(128);
    expect(toByte(2)).toBe(255);
    expect(toByte(-1)).toBe(0);
  });
  it("makes red and green alike for protanopia and deuteranopia", () => {
    // Pure red loses its difference between the red and green channels: it looks olive.
    const [r, g] = simulate("deuteranopia", [255, 0, 0]);
    expect(Math.abs((r ?? 0) - (g ?? 0))).toBeLessThan(60);
    expect(simulate("protanopia", [255, 0, 0])[0]).toBeLessThan(120);
  });
  it("turns colour to grey for achromatopsia, and keeps alpha", () => {
    const [r, g, b] = simulate("achromatopsia", [255, 0, 0]);
    expect(r).toBe(g);
    expect(g).toBe(b);
    const pixels = Uint8ClampedArray.from([0, 0, 255, 77]);
    simulatePixels("achromatopsia", pixels);
    expect(pixels[0]).toBe(pixels[1]);
    expect(pixels[3]).toBe(77);
  });
});
