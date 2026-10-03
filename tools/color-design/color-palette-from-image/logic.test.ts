import { describe, expect, it } from "vitest";
import { checkFile, LIMITS, MESSAGES, run, sampleSize, withinPixelLimit } from "./logic";

/** RGBA bytes: `n` pixels of each colour given as [r, g, b, a]. */
function pixels(...groups: Array<[number, [number, number, number, number]]>): Uint8Array {
  const out: number[] = [];
  for (const [n, rgba] of groups) for (let i = 0; i < n; i++) out.push(...rgba);
  return new Uint8Array(out);
}

describe("run (median cut)", () => {
  it("finds the two colours of a two-colour picture, largest first, with their shares", () => {
    const result = run({
      pixels: pixels([300, [255, 0, 0, 255]], [100, [0, 0, 255, 255]]),
      count: 2,
    });
    expect(result).toEqual({
      ok: true,
      colors: [
        { hex: "#ff0000", share: 75 },
        { hex: "#0000ff", share: 25 },
      ],
    });
  });

  it("gives fewer colours than asked when the picture has fewer, never a repeat", () => {
    const result = run({ pixels: pixels([50, [10, 20, 30, 255]]), count: 8 });
    expect(result).toEqual({ ok: true, colors: [{ hex: "#0a141e", share: 100 }] });
  });

  it("finds eight colours in a picture of eight", () => {
    const eight: Array<[number, [number, number, number, number]]> = [
      [10, [0, 0, 0, 255]],
      [10, [255, 255, 255, 255]],
      [10, [255, 0, 0, 255]],
      [10, [0, 255, 0, 255]],
      [10, [0, 0, 255, 255]],
      [10, [255, 255, 0, 255]],
      [10, [0, 255, 255, 255]],
      [10, [255, 0, 255, 255]],
    ];
    const result = run({ pixels: pixels(...eight), count: 8 });
    expect(result.ok && result.colors.map((c) => c.hex).sort()).toEqual(
      [
        "#000000",
        "#ffffff",
        "#ff0000",
        "#00ff00",
        "#0000ff",
        "#ffff00",
        "#00ffff",
        "#ff00ff",
      ].sort(),
    );
  });

  it("leaves out transparent pixels and refuses a fully transparent picture", () => {
    const result = run({
      pixels: pixels([100, [255, 0, 0, 0]], [10, [0, 128, 0, 255]]),
      count: 3,
    });
    expect(result).toEqual({ ok: true, colors: [{ hex: "#008000", share: 100 }] });
    expect(run({ pixels: pixels([5, [1, 2, 3, 127]]), count: 2 })).toEqual({
      ok: false,
      error: MESSAGES.transparent,
    });
  });

  it("takes 1 and 8 colours and refuses 0 and 9", () => {
    const some = pixels([4, [1, 1, 1, 255]]);
    expect(run({ pixels: some, count: LIMITS.minColors }).ok).toBe(true);
    expect(run({ pixels: some, count: LIMITS.maxColors }).ok).toBe(true);
    expect(run({ pixels: some, count: 0 })).toEqual({ ok: false, error: MESSAGES.count });
    expect(run({ pixels: some, count: 9 })).toEqual({ ok: false, error: MESSAGES.count });
  });
});

describe("file rules", () => {
  it("takes exactly 25 MB and refuses one byte more", () => {
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: LIMITS.maxInputBytes })).toBeNull();
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: LIMITS.maxInputBytes + 1 })).toBe(
      "This file is larger than 25 MB.",
    );
    expect(checkFile({ name: "a.gif", type: "image/gif", size: 1 })).toBe(MESSAGES.notAnImage);
  });

  it("shrinks the longest side to 200 and never enlarges", () => {
    expect(sampleSize(4000, 3000)).toEqual({ width: 200, height: 150 });
    expect(sampleSize(50, 20)).toEqual({ width: 50, height: 20 });
    expect(sampleSize(10_000, 1)).toEqual({ width: 200, height: 1 });
  });

  it("takes exactly 50 megapixels and refuses more", () => {
    expect(withinPixelLimit(10_000, 5_000)).toBe(true);
    expect(withinPixelLimit(10_000, 5_001)).toBe(false);
  });
});
