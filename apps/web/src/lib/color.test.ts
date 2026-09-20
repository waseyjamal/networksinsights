import { describe, expect, it } from "vitest";
import {
  composite,
  contrastRatio,
  inGamut,
  mixOklab,
  oklabToSrgb,
  oklchToSrgb,
  toBytes,
  toHex,
} from "./color";

// The converter decides whether the design tokens pass WCAG, so it is validated against
// independent references before any contrast result is trusted.

describe("oklchToSrgb: reference conversions", () => {
  // Source 1: the real conversion in Chromium, Firefox and WebKit (Playwright 1.63.0, canvas
  // getImageData in an sRGB context), taken on 2026-09-20. All three engines agree within 1/255.
  // Every color here is inside the sRGB gamut, so no gamut mapping is involved.
  const browserReferences: Array<[string, [number, number, number]]> = [
    ["oklch(0.5 0.1 30)", [148, 75, 64]],
    ["oklch(0.7 0.15 150)", [76, 184, 106]],
    ["oklch(0.6 0.2 260)", [46, 121, 245]],
    ["oklch(0.85 0.08 90)", [226, 204, 145]],
    ["oklch(0.4 0.05 200)", [34, 80, 82]],
    ["oklch(0.9 0.02 280)", [219, 221, 236]],
    ["oklch(0.3 0.12 320)", [70, 16, 82]],
    ["oklch(0.65 0.12 60)", [196, 124, 59]],
    ["oklch(0.55 0.22 277)", [89, 87, 237]],
  ];

  it.each(browserReferences)("%s matches the browsers", (input, expected) => {
    const bytes = toBytes(oklchToSrgb(input));
    for (const i of [0, 1, 2] as const) {
      expect(Math.abs(bytes[i] - expected[i])).toBeLessThanOrEqual(1);
    }
  });

  // Source 2: the sRGB primaries as published by the author of OKLab, Björn Ottosson
  // (https://bottosson.github.io/posts/oklab/ and CSS Color Level 4).
  const primaries: Array<[string, string, [number, number, number]]> = [
    ["white", "oklch(1 0 0)", [255, 255, 255]],
    ["black", "oklch(0 0 0)", [0, 0, 0]],
    ["red", "oklch(0.62796 0.25768 29.234)", [255, 0, 0]],
    ["green", "oklch(0.86644 0.29483 142.495)", [0, 255, 0]],
    ["blue", "oklch(0.45201 0.31321 264.052)", [0, 0, 255]],
  ];

  it.each(primaries)("%s primary matches the published OKLCH value", (_name, input, expected) => {
    expect(toBytes(oklchToSrgb(input))).toEqual(expected);
  });

  it("converts the published OKLab (not OKLCH) values of the primaries", () => {
    const red = oklabToSrgb({ L: 0.62796, a: 0.22486, b: 0.12585, alpha: 1 });
    expect(toHex(red)).toBe("#ff0000");
    const blue = oklabToSrgb({ L: 0.45201, a: -0.03246, b: -0.31153, alpha: 1 });
    expect(toHex(blue)).toBe("#0000ff");
  });

  it("reports colors outside the sRGB gamut", () => {
    expect(inGamut(oklchToSrgb("oklch(0.6 0.2 260)"))).toBe(true);
    expect(inGamut(oklchToSrgb("oklch(0.6 0.4 145)"))).toBe(false);
  });

  it("parses percentages and alpha", () => {
    expect(toHex(oklchToSrgb("oklch(100% 0 0)"))).toBe("#ffffff");
    expect(oklchToSrgb("oklch(0.5 0.1 30 / 0.4)").a).toBeCloseTo(0.4, 5);
    expect(oklchToSrgb("oklch(0.5 0.1 30 / 40%)").a).toBeCloseTo(0.4, 5);
    expect(() => oklchToSrgb("rgb(0 0 0)")).toThrow();
  });
});

describe("contrastRatio: WCAG reference values", () => {
  const rgb = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
  };

  it("black on white is exactly 21:1", () => {
    expect(contrastRatio(rgb("#000000"), rgb("#ffffff"))).toBeCloseTo(21, 5);
  });

  it("is symmetric and 1:1 for equal colors", () => {
    expect(contrastRatio(rgb("#336699"), rgb("#336699"))).toBeCloseTo(1, 5);
    expect(contrastRatio(rgb("#336699"), rgb("#ffffff"))).toBeCloseTo(
      contrastRatio(rgb("#ffffff"), rgb("#336699")),
      8,
    );
  });

  it("#767676 on white is the well-known 4.54:1 AA boundary", () => {
    expect(contrastRatio(rgb("#767676"), rgb("#ffffff"))).toBeCloseTo(4.54, 2);
  });

  it("#777777 on white is 4.48:1, which fails AA", () => {
    const ratio = contrastRatio(rgb("#777777"), rgb("#ffffff"));
    expect(ratio).toBeCloseTo(4.48, 2);
    expect(ratio).toBeLessThan(4.5);
  });
});

describe("compositing and mixing", () => {
  it("composites a 50% white over black to mid gray in gamma space", () => {
    const out = composite({ r: 1, g: 1, b: 1, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 });
    expect(toBytes(out)).toEqual([128, 128, 128]);
  });

  it("mixes in OKLab like color-mix(in oklab)", () => {
    const white = oklchToSrgb("oklch(1 0 0)");
    const black = oklchToSrgb("oklch(0 0 0)");
    const mid = mixOklab(white, black, 0.5);
    // OKLab lightness 0.5 is sRGB #636363.
    expect(toHex(mid)).toBe("#636363");
    expect(toHex(mixOklab(white, black, 1))).toBe("#ffffff");
  });
});
