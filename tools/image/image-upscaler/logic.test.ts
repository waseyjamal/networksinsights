import { describe, expect, it } from "vitest";
import {
  checkFile,
  checkPixels,
  HALO,
  isOutOfMemory,
  isSmallDevice,
  LIMITS,
  MAX_OUTPUT_PIXELS,
  MESSAGES,
  outputName,
  pixelLimit,
  planTiles,
  SCALE,
  scaleAlpha,
  TILE,
  type Tile,
  tileCount,
  tileTensor,
  toHex,
  writeTile,
} from "./logic";

const desktop = { touchPrimary: false, deviceMemory: 8 };
const phone = { touchPrimary: true };
const safari = { touchPrimary: false };

describe("the device's pixel limit", () => {
  it("treats a touch-first device or 4 GB of memory or less as a phone", () => {
    expect(isSmallDevice(phone)).toBe(true);
    expect(isSmallDevice({ touchPrimary: true, deviceMemory: 8 })).toBe(true);
    expect(isSmallDevice({ touchPrimary: false, deviceMemory: 4 })).toBe(true);
    expect(isSmallDevice({ touchPrimary: false, deviceMemory: 2 })).toBe(true);
    expect(isSmallDevice(desktop)).toBe(false);
  });

  it("does not treat a missing deviceMemory (Safari, Firefox) as a phone", () => {
    expect(isSmallDevice(safari)).toBe(false);
    expect(isSmallDevice({ touchPrimary: false, deviceMemory: undefined })).toBe(false);
    expect(pixelLimit(safari)).toBe(1_000_000);
  });

  it("allows 1 megapixel on a desktop and 0.5 on a phone, at and over the edge", () => {
    expect(pixelLimit(desktop)).toBe(LIMITS.desktopPixels);
    expect(pixelLimit(phone)).toBe(LIMITS.phonePixels);
    expect(checkPixels(1000, 1000, desktop)).toBeNull();
    expect(checkPixels(1001, 1000, desktop)).toBe(MESSAGES.tooManyPixels(1001, 1000, 1_000_000));
    expect(checkPixels(1000, 500, phone)).toBeNull();
    expect(checkPixels(1000, 501, phone)).toBe(MESSAGES.tooManyPixels(1000, 501, 500_000));
    expect(MESSAGES.tooManyPixels(1001, 1000, 1_000_000)).toContain("at most 1 megapixels");
    expect(MESSAGES.tooManyPixels(1000, 501, 500_000)).toContain("at most 0.5 megapixels");
  });

  it("keeps every result within 16 megapixels", () => {
    expect(LIMITS.desktopPixels * SCALE * SCALE).toBeLessThanOrEqual(MAX_OUTPUT_PIXELS);
    expect(checkPixels(4000, 250, desktop)).toBeNull();
    expect(checkPixels(0, 10, desktop)).toBe(MESSAGES.unreadable);
  });
});

describe("the file rules", () => {
  const file = (name: string, type: string, size = 1000) => ({ name, type, size });

  it("takes JPG, PNG and WebP, and a known extension when the browser gives no type", () => {
    expect(checkFile(file("a.jpg", "image/jpeg"))).toBeNull();
    expect(checkFile(file("a.png", "image/png"))).toBeNull();
    expect(checkFile(file("a.webp", "image/webp"))).toBeNull();
    expect(checkFile(file("a.webp", ""))).toBeNull();
    expect(checkFile(file("a.gif", "image/gif"))).toBe(MESSAGES.notImage);
    expect(checkFile(file("a.txt", ""))).toBe(MESSAGES.notImage);
  });

  it("refuses a file over 30 MB, and takes one of exactly 30 MB", () => {
    expect(checkFile(file("a.png", "image/png", LIMITS.maxInputBytes))).toBeNull();
    expect(checkFile(file("a.png", "image/png", LIMITS.maxInputBytes + 1))).toBe(
      MESSAGES.tooLarge("30 MB"),
    );
  });
});

describe("the tiles", () => {
  it("covers every pixel exactly once, with up to HALO pixels of context inside the picture", () => {
    for (const [width, height] of [
      [224, 96],
      [1000, 1000],
      [1, 1],
      [193, 385],
    ] as const) {
      const tiles = planTiles(width, height);
      const seen = new Uint8Array(width * height);
      for (const tile of tiles) {
        expect(tile.width).toBeLessThanOrEqual(TILE);
        expect(tile.height).toBeLessThanOrEqual(TILE);
        expect(tile.inX).toBe(Math.max(0, tile.x - HALO));
        expect(tile.inY).toBe(Math.max(0, tile.y - HALO));
        expect(tile.inX + tile.inWidth).toBe(Math.min(width, tile.x + tile.width + HALO));
        expect(tile.inY + tile.inHeight).toBe(Math.min(height, tile.y + tile.height + HALO));
        for (let y = tile.y; y < tile.y + tile.height; y++) {
          for (let x = tile.x; x < tile.x + tile.width; x++)
            seen[y * width + x] = (seen[y * width + x] ?? 0) + 1;
        }
      }
      expect(seen.every((count) => count === 1)).toBe(true);
      expect(tiles.length).toBe(tileCount(width, height));
    }
  });

  it("cuts the 224 × 96 test picture into two tiles", () => {
    expect(planTiles(224, 96)).toEqual([
      { x: 0, y: 0, width: 192, height: 96, inX: 0, inY: 0, inWidth: 224, inHeight: 96 },
      { x: 192, y: 0, width: 32, height: 96, inX: 158, inY: 0, inWidth: 66, inHeight: 96 },
    ]);
  });

  it("stitches the tiles of a stand-in model back into the whole result", () => {
    // A stand-in for the model: each pixel repeated over a 4 × 4 block. Stitched from tiles, the
    // result must be the same picture scaled 4 times, with no seam and nothing missing.
    const width = 400;
    const height = 230;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < source.length; i++) source[i] = (i * 37 + (i >> 9)) % 256;
    const nearest = (input: Float32Array, tile: Tile) => {
      const outWidth = tile.inWidth * SCALE;
      const outHeight = tile.inHeight * SCALE;
      const plane = tile.inWidth * tile.inHeight;
      const output = new Float32Array(3 * outWidth * outHeight);
      for (let c = 0; c < 3; c++) {
        for (let y = 0; y < outHeight; y++) {
          for (let x = 0; x < outWidth; x++) {
            output[c * outWidth * outHeight + y * outWidth + x] =
              input[c * plane + Math.floor(y / SCALE) * tile.inWidth + Math.floor(x / SCALE)] ?? 0;
          }
        }
      }
      return output;
    };
    const result = new Uint8ClampedArray(width * SCALE * height * SCALE * 4);
    for (const tile of planTiles(width, height)) {
      writeTile(result, width * SCALE, tile, nearest(tileTensor(source, width, tile), tile));
    }
    scaleAlpha(source, width, height, result);
    for (let y = 0; y < height * SCALE; y += 7) {
      for (let x = 0; x < width * SCALE; x += 5) {
        const s = (Math.floor(y / SCALE) * width + Math.floor(x / SCALE)) * 4;
        const r = (y * width * SCALE + x) * 4;
        expect([result[r], result[r + 1], result[r + 2], result[r + 3]]).toEqual([
          source[s],
          source[s + 1],
          source[s + 2],
          source[s + 3],
        ]);
      }
    }
  });

  it("gives the model RGB planes from 0 to 1", () => {
    const rgba = new Uint8ClampedArray([255, 0, 51, 7, 0, 255, 102, 9]);
    const tile = planTiles(2, 1)[0] as Tile;
    expect(Array.from(tileTensor(rgba, 2, tile))).toEqual([1, 0, 0, 1, 0.2, 0.4].map(Math.fround));
  });

  it("rounds the model's output to 8 bits and clamps it", () => {
    const tile: Tile = { x: 0, y: 0, width: 1, height: 1, inX: 0, inY: 0, inWidth: 1, inHeight: 1 };
    const output = new Float32Array(3 * 16);
    output.fill(1.2, 0, 16);
    output.fill(-0.1, 16, 32);
    output.fill(0.5, 32, 48);
    const result = new Uint8ClampedArray(16 * 4);
    writeTile(result, 4, tile, output);
    expect(Array.from(result.slice(0, 3))).toEqual([255, 0, 128]);
  });
});

describe("errors, hashes and names", () => {
  it("knows an allocation failure from any other failure", () => {
    expect(isOutOfMemory(new RangeError("Array buffer allocation failed"))).toBe(true);
    expect(isOutOfMemory(new Error("failed to allocate a buffer of size 123456"))).toBe(true);
    expect(isOutOfMemory(new Error("RuntimeError: Aborted(OOM)"))).toBe(true);
    expect(isOutOfMemory("std::bad_alloc")).toBe(true);
    expect(isOutOfMemory(new Error("invalid input name"))).toBe(false);
  });

  it("writes a SHA-256 as lowercase hex", async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc"));
    expect(toHex(digest)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("names the result after the picture", () => {
    expect(outputName("holiday.jpg")).toBe("holiday-4x.png");
    expect(outputName(".png")).toBe("picture-4x.png");
  });
});
