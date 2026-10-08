import { describe, expect, it } from "vitest";
import {
  blurRect,
  boxFrom,
  censor,
  checkFile,
  checkRegions,
  fillRect,
  formatDimensions,
  LIMITS,
  MESSAGES,
  moveRegion,
  outputName,
  pixelateRect,
  previewSize,
  type Region,
  regionPixels,
  resizeRegion,
  WORK_PIXELS,
  workSize,
} from "./logic";

const region = (over: Partial<Region> = {}): Region => ({
  id: "r1",
  x: 0.25,
  y: 0.25,
  width: 0.5,
  height: 0.5,
  mode: "fill",
  color: "#ff0000",
  block: 4,
  radius: 3,
  ...over,
});

/** A width × height picture where every pixel differs: a pattern of stripes and a gradient. */
function picture(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = (x * 37 + y * 11) % 256;
      pixels[i + 1] = x % 4 < 2 ? 220 : 30;
      pixels[i + 2] = (y * 9) % 256;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

const pixel = (pixels: Uint8ClampedArray, width: number, x: number, y: number) => [
  ...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
];

describe("checkFile", () => {
  it("takes JPG, PNG and WebP, by type or by name, up to 25 MB", () => {
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: 10 })).toBeNull();
    expect(checkFile({ name: "a.webp", type: "", size: 10 })).toBeNull();
    expect(checkFile({ name: "a.png", type: "image/png", size: LIMITS.maxInputBytes })).toBeNull();
    expect(checkFile({ name: "a.png", type: "image/png", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooLarge("25 MB"),
    );
    expect(checkFile({ name: "a.gif", type: "image/gif", size: 10 })).toBe(MESSAGES.notAnImage);
  });
});

describe("workSize", () => {
  it("keeps a picture of 16 megapixels or less as it is", () => {
    expect(workSize(4000, 4000)).toEqual({ width: 4000, height: 4000 });
    expect(workSize(5000, 3200)).toEqual({ width: 5000, height: 3200 });
  });

  it("scales a larger one down to at most 16 megapixels, keeping its shape", () => {
    const size = workSize(6000, 4000);
    expect(size.width * size.height).toBeLessThanOrEqual(WORK_PIXELS);
    expect(size.width / size.height).toBeCloseTo(1.5, 2);
    expect(size).toEqual({ width: 4898, height: 3265 });
  });

  it("gives a preview of at most 1,200 pixels a side", () => {
    expect(previewSize(4000, 2000)).toEqual({ width: 1200, height: 600 });
    expect(previewSize(300, 200)).toEqual({ width: 300, height: 200 });
  });
});

describe("regions", () => {
  it("makes a region from a drag in any direction, and ignores a click", () => {
    expect(
      boxFrom([
        { x: 0.8, y: 0.9 },
        { x: 0.2, y: 0.1 },
      ]),
    ).toEqual({ x: 0.2, y: 0.1, width: expect.closeTo(0.6), height: expect.closeTo(0.8) });
    expect(
      boxFrom([
        { x: 0.5, y: 0.5 },
        { x: 0.501, y: 0.501 },
      ]),
    ).toBeNull();
  });

  it("keeps a moved or resized region on the picture", () => {
    expect(moveRegion(region(), 0.9, -1)).toMatchObject({ x: 0.5, y: 0 });
    expect(resizeRegion(region(), 2, 0)).toMatchObject({ width: 0.75, height: 0.005 });
  });

  it("covers whole pixels, out to the edge", () => {
    expect(regionPixels({ x: 0.1, y: 0.1, width: 0.25, height: 0.9 }, 10, 10)).toEqual({
      x: 1,
      y: 1,
      width: 3,
      height: 9,
    });
  });

  it("needs at least one region, at most 50, each with a valid setting", () => {
    expect(checkRegions([])).toBe(MESSAGES.noRegions);
    expect(checkRegions(Array.from({ length: 51 }, () => region()))).toBe(MESSAGES.tooManyRegions);
    expect(checkRegions([region({ color: "red" })])).toBe(MESSAGES.color);
    expect(checkRegions([region({ x: Number.NaN })])).toBe(MESSAGES.place);
    expect(checkRegions([region({ width: 0 })])).toBe(MESSAGES.place);
    expect(checkRegions([region({ mode: "pixelate", block: 1 })])).toBe(
      "Block size must be a whole number from 2 to 200.",
    );
    expect(checkRegions([region({ mode: "blur", radius: 101 })])).toBe(
      "Blur radius must be a whole number from 1 to 100.",
    );
    expect(checkRegions([region({ mode: "blur", radius: 2.5 })])).not.toBeNull();
    expect(checkRegions([region(), region({ mode: "blur", radius: 100 })])).toBeNull();
  });
});

describe("fillRect", () => {
  it("sets every pixel in the rectangle to the colour, and none outside", () => {
    const pixels = picture(8, 8);
    const before = pixels.slice();
    fillRect(pixels, 8, { x: 2, y: 3, width: 4, height: 2 }, "#123456");
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const inside = x >= 2 && x < 6 && y >= 3 && y < 5;
        expect(pixel(pixels, 8, x, y)).toEqual(
          inside ? [0x12, 0x34, 0x56, 255] : pixel(before, 8, x, y),
        );
      }
    }
  });
});

describe("pixelateRect", () => {
  it("makes blocks of one colour, each the average of its pixels", () => {
    const pixels = new Uint8ClampedArray(4 * 2 * 4);
    // Row 0: 0, 10, 20, 30; row 1: 40, 50, 60, 70 (red only).
    for (let i = 0; i < 8; i++) {
      pixels[i * 4] = i * 10;
      pixels[i * 4 + 3] = 255;
    }
    pixelateRect(pixels, 4, { x: 0, y: 0, width: 4, height: 2 }, 2);
    expect([0, 1, 4, 5].map((i) => pixels[i * 4])).toEqual([25, 25, 25, 25]);
    expect([2, 3, 6, 7].map((i) => pixels[i * 4])).toEqual([45, 45, 45, 45]);
  });

  it("gives smaller blocks where the rectangle ends, and leaves the outside alone", () => {
    const pixels = picture(10, 10);
    const before = pixels.slice();
    pixelateRect(pixels, 10, { x: 1, y: 1, width: 7, height: 7 }, 3);
    // Blocks start at 1, 4 and 7; the last is one pixel wide.
    expect(pixel(pixels, 10, 4, 4)).toEqual(pixel(pixels, 10, 6, 6));
    expect(pixel(pixels, 10, 7, 7)).toEqual(pixel(before, 10, 7, 7));
    expect(pixel(pixels, 10, 0, 0)).toEqual(pixel(before, 10, 0, 0));
    expect(pixel(pixels, 10, 8, 8)).toEqual(pixel(before, 10, 8, 8));
  });
});

describe("blurRect", () => {
  it("changes the pixels inside, keeps a flat area flat and the outside unchanged", () => {
    const pixels = picture(20, 20);
    const before = pixels.slice();
    blurRect(pixels, 20, { x: 5, y: 5, width: 10, height: 10 }, 2);
    expect(pixel(pixels, 20, 10, 10)).not.toEqual(pixel(before, 20, 10, 10));
    for (const [x, y] of [
      [4, 4],
      [15, 15],
      [0, 19],
      [15, 5],
    ] as const) {
      expect(pixel(pixels, 20, x, y)).toEqual(pixel(before, 20, x, y));
    }
    const flat = new Uint8ClampedArray(6 * 6 * 4).fill(77);
    blurRect(flat, 6, { x: 0, y: 0, width: 6, height: 6 }, 3);
    expect([...new Set(flat)]).toEqual([77]);
  });

  it("keeps the mean colour of the region close", () => {
    const pixels = picture(40, 40);
    const rect = { x: 0, y: 0, width: 40, height: 40 };
    const mean = (data: Uint8ClampedArray, c: number) => {
      let sum = 0;
      for (let i = c; i < data.length; i += 4) sum += data[i] ?? 0;
      return sum / (data.length / 4);
    };
    const before = [0, 1, 2].map((c) => mean(pixels, c));
    blurRect(pixels, 40, rect, 4);
    for (const c of [0, 1, 2]) expect(Math.abs(mean(pixels, c) - (before[c] ?? 0))).toBeLessThan(3);
  });
});

describe("censor", () => {
  it("draws a later region over an earlier one where they overlap", () => {
    const pixels = picture(10, 10);
    censor(pixels, 10, 10, [
      region({ x: 0, y: 0, width: 0.6, height: 0.6, color: "#ff0000" }),
      region({ x: 0.4, y: 0.4, width: 0.6, height: 0.6, color: "#0000ff" }),
    ]);
    expect(pixel(pixels, 10, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(pixel(pixels, 10, 5, 5)).toEqual([0, 0, 255, 255]);
    expect(pixel(pixels, 10, 9, 9)).toEqual([0, 0, 255, 255]);
  });
});

describe("names and sizes", () => {
  it("names the result after the input, in the chosen format", () => {
    expect(outputName("street.jpg", "image/png")).toBe("street-censored.png");
    expect(outputName("scan.webp", "image/jpeg")).toBe("scan-censored.jpg");
  });

  it("writes dimensions with thousands separators", () => {
    expect(formatDimensions(4898, 3265)).toBe("4,898 × 3,265");
  });
});
