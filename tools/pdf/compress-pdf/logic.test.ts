import { describe, expect, it } from "vitest";
import {
  BITMAP_FORMATS,
  checkFile,
  checkPages,
  formatSize,
  hasTransparency,
  KEEP_RATIO,
  LEVELS,
  LIMITS,
  MESSAGES,
  outputName,
  sameText,
  savingLabel,
  skipReason,
  targetSize,
  toRgba,
  worthReplacing,
} from "./logic";

const pdf = (size: number) => ({ name: "a.pdf", type: "application/pdf", size });

describe("file rules", () => {
  it("accepts a PDF of exactly 50 MB and refuses one byte more", () => {
    expect(LIMITS.maxInputBytes).toBe(52_428_800);
    expect(checkFile(pdf(LIMITS.maxInputBytes))).toBeUndefined();
    expect(checkFile(pdf(LIMITS.maxInputBytes + 1))).toBe("This file is larger than 50 MB.");
  });

  it("refuses a file that is not a PDF, and accepts a .pdf with no type", () => {
    expect(checkFile({ name: "a.png", type: "image/png", size: 10 })).toBe(MESSAGES.notAPdf);
    expect(checkFile({ name: "A.PDF", type: "", size: 10 })).toBeUndefined();
  });

  it("works on 1 to 500 pages", () => {
    expect(checkPages(0)).toBe(MESSAGES.noPages);
    expect(checkPages(1)).toBeUndefined();
    expect(checkPages(500)).toBeUndefined();
    expect(checkPages(501)).toBe("This PDF has 501 pages. Compress PDF works on up to 500 pages.");
  });
});

describe("pictures", () => {
  it("brings a picture down to the level's resolution, never up", () => {
    expect(targetSize(3000, 2000, 300, LEVELS.recommended.dpi)).toEqual({
      width: 1500,
      height: 1000,
    });
    expect(targetSize(3000, 2000, 300, LEVELS.strong.dpi)).toEqual({ width: 960, height: 640 });
    expect(targetSize(800, 600, 144, 150)).toEqual({ width: 800, height: 600 });
    expect(targetSize(800, 600, 150, 150)).toEqual({ width: 800, height: 600 });
    expect(targetSize(1, 1, 10_000, 96)).toEqual({ width: 1, height: 1 });
    expect(targetSize(500, 500, Number.NaN, 96)).toEqual({ width: 500, height: 500 });
  });

  it("keeps pictures over 25 megapixels, unusual bit depths and colour spaces", () => {
    const rgb = { bitsPerPixel: 24, colorSpace: 2 };
    expect(skipReason({ width: 5000, height: 5000, ...rgb })).toBeNull();
    expect(skipReason({ width: 5000, height: 5001, ...rgb })).toBe("large");
    expect(skipReason({ width: 10, height: 10, bitsPerPixel: 1, colorSpace: 1 })).toBe("format");
    expect(skipReason({ width: 10, height: 10, bitsPerPixel: 32, colorSpace: 3 })).toBe("format");
    expect(skipReason({ width: 10, height: 10, bitsPerPixel: 8, colorSpace: 9 })).toBe("format");
    for (const colorSpace of [1, 2, 4, 5, 7, 10]) {
      expect(skipReason({ width: 10, height: 10, bitsPerPixel: 8, colorSpace })).toBeNull();
    }
  });

  it("replaces a picture only when the JPEG is at most 90% of its bytes", () => {
    expect(KEEP_RATIO).toBe(0.9);
    expect(worthReplacing(900, 1000)).toBe(true);
    expect(worthReplacing(901, 1000)).toBe(false);
    expect(worthReplacing(2000, 1000)).toBe(false);
    expect(worthReplacing(0, 1000)).toBe(false);
  });

  it("reads grey, BGR and BGRx rows with padding into opaque RGBA", () => {
    // Two pixels a row, rows padded to 8 bytes.
    const bgr = new Uint8Array([1, 2, 3, 4, 5, 6, 0, 0, 7, 8, 9, 10, 11, 12, 0, 0]);
    expect([...(toRgba(bgr, 2, 2, 8, BITMAP_FORMATS.bgr) ?? [])]).toEqual([
      3, 2, 1, 255, 6, 5, 4, 255, 9, 8, 7, 255, 12, 11, 10, 255,
    ]);
    const bgrx = new Uint8Array([1, 2, 3, 0, 4, 5, 6, 0]);
    expect([...(toRgba(bgrx, 2, 1, 8, BITMAP_FORMATS.bgrx) ?? [])]).toEqual([
      3, 2, 1, 255, 6, 5, 4, 255,
    ]);
    const grey = new Uint8Array([10, 20, 0, 0]);
    expect([...(toRgba(grey, 2, 1, 4, BITMAP_FORMATS.gray) ?? [])]).toEqual([
      10, 10, 10, 255, 20, 20, 20, 255,
    ]);
    expect(toRgba(bgrx, 2, 1, 8, BITMAP_FORMATS.bgra)).toBeNull();
  });

  it("finds a pixel that is not fully opaque", () => {
    const opaque = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 9, 9]);
    expect(hasTransparency(opaque, 2, 1, 10)).toBe(false);
    const clear = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 254]);
    expect(hasTransparency(clear, 2, 1, 8)).toBe(true);
  });
});

describe("the result", () => {
  it("compares page texts, ignoring spaces and line breaks", () => {
    expect(sameText(["Page 1 text", "Two"], ["Page 1\r\ntext", "Two "])).toBe(true);
    expect(sameText(["Page 1"], ["Page 2"])).toBe(false);
    expect(sameText(["a"], ["a", "b"])).toBe(false);
  });

  it("names the file and the saving, rounding the percentage down", () => {
    expect(outputName("scan.pdf")).toBe("scan-compressed.pdf");
    expect(outputName(".pdf")).toBe("document-compressed.pdf");
    expect(savingLabel(20_578_306, 1_551_748)).toBe("92% smaller");
    expect(savingLabel(1000, 995)).toBe("less than 1% smaller");
    expect(savingLabel(1000, 1000)).toBe("not smaller");
    expect(formatSize(1_551_748)).toBe("1.5 MB");
  });
});
