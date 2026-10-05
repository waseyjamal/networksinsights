import { describe, expect, it } from "vitest";
import {
  checkFile,
  clampFrame,
  initialFrame,
  LIMITS,
  MESSAGES,
  mmToPixels,
  outputName,
  photoSize,
  readJpegDpi,
  scaleFrame,
  sheetLayout,
  withinPixelLimit,
  withJpegDpi,
} from "./logic";

const form = {
  size: "uk" as const,
  width: "",
  height: "",
  unit: "mm" as const,
  dpi: "300",
};

const sizeOf = (changes: Partial<Parameters<typeof photoSize>[0]>) => {
  const sized = photoSize({ ...form, ...changes });
  return sized.ok ? sized.size : sized.error;
};

describe("photo sizes", () => {
  it("turns the presets into pixels at a DPI", () => {
    expect(sizeOf({})).toMatchObject({ width: 413, height: 531, widthMm: 35, heightMm: 45 });
    expect(sizeOf({ size: "us" })).toMatchObject({ width: 600, height: 600 });
    expect(sizeOf({ size: "us", dpi: "600" })).toMatchObject({ width: 1200, height: 1200 });
    expect(mmToPixels(25.4, 150)).toBe(150);
  });

  it("takes a custom size in mm or inches, within its limits", () => {
    expect(sizeOf({ size: "custom", width: "10", height: "100" })).toMatchObject({
      width: 118,
      height: 1181,
    });
    expect(sizeOf({ size: "custom", width: "9.9", height: "40" })).toBe(MESSAGES.width("mm"));
    expect(sizeOf({ size: "custom", width: "40", height: "100.1" })).toBe(MESSAGES.height("mm"));
    expect(sizeOf({ size: "custom", unit: "in", width: "2", height: "2,5" })).toMatchObject({
      width: 600,
      height: 750,
    });
    expect(sizeOf({ size: "custom", unit: "in", width: "0.4", height: "3.9" })).toMatchObject({
      width: 120,
      height: 1170,
    });
    expect(sizeOf({ size: "custom", unit: "in", width: "0.39", height: "2" })).toBe(
      MESSAGES.width("in"),
    );
    expect(MESSAGES.width("in")).toBe("The width must be a number from 0.4 to 3.9 inches.");
    expect(sizeOf({ size: "custom", width: "abc", height: "2" })).toBe(MESSAGES.width("mm"));
  });

  it("takes a DPI of 150 to 600", () => {
    expect(sizeOf({ dpi: "150" })).toMatchObject({ dpi: 150 });
    expect(sizeOf({ dpi: "600" })).toMatchObject({ dpi: 600 });
    expect(sizeOf({ dpi: "149" })).toBe(MESSAGES.dpi);
    expect(sizeOf({ dpi: "601" })).toBe(MESSAGES.dpi);
    expect(sizeOf({ dpi: "300.5" })).toBe(MESSAGES.dpi);
  });
});

describe("the crop frame", () => {
  const image = { width: 1200, height: 800 };
  const aspect = 35 / 45;

  it("starts as the largest centred frame of the photo's shape", () => {
    const frame = initialFrame(image, aspect);
    expect(frame.height).toBeCloseTo(800);
    expect(frame.width).toBeCloseTo(800 * aspect);
    expect(frame.x).toBeCloseTo((1200 - 800 * aspect) / 2);
    expect(frame.y).toBeCloseTo(0);
  });

  it("stays inside the picture and keeps its shape", () => {
    const frame = clampFrame({ x: -50, y: 900, width: 300 }, image, aspect);
    expect(frame.x).toBe(0);
    expect(frame.y).toBeCloseTo(800 - 300 / aspect);
    expect(frame.width / frame.height).toBeCloseTo(aspect);
    const huge = clampFrame({ x: 0, y: 0, width: 5000 }, image, aspect);
    expect(huge.height).toBeCloseTo(800);
  });

  it("resizes around its centre, not below a tenth of the largest frame", () => {
    const start = initialFrame(image, aspect);
    const smaller = scaleFrame(start, 0.5, image, aspect);
    expect(smaller.width).toBeCloseTo(start.width / 2);
    expect(smaller.x + smaller.width / 2).toBeCloseTo(600);
    const tiny = scaleFrame(start, 0.01, image, aspect);
    expect(tiny.width).toBeCloseTo(start.width * 0.1);
  });
});

describe("the print sheet", () => {
  const uk = photoSize(form);
  const us = photoSize({ ...form, size: "us" });
  if (!uk.ok || !us.ok) throw new Error("bad preset");

  it("fits 8 UK photos on 4 × 6 inch paper, landscape", () => {
    const layout = sheetLayout("4x6", uk.size);
    expect(layout.ok && layout.sheet).toMatchObject({
      landscape: true,
      columns: 4,
      rows: 2,
      width: 1800,
      height: 1200,
    });
    if (layout.ok) {
      for (const [x, y] of layout.sheet.positions) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x + uk.size.width).toBeLessThanOrEqual(1800);
        expect(y + uk.size.height).toBeLessThanOrEqual(1200);
      }
    }
  });

  it("fits 2 US photos on 4 × 6 inch paper, portrait on a tie", () => {
    const layout = sheetLayout("4x6", us.size);
    expect(layout.ok && layout.sheet).toMatchObject({ landscape: false, columns: 1, rows: 2 });
  });

  it("refuses a sheet over 16.7 megapixels", () => {
    const at600 = photoSize({ ...form, dpi: "600" });
    if (!at600.ok) throw new Error("bad size");
    expect(sheetLayout("a4", at600.size)).toEqual({ ok: false, error: MESSAGES.sheetTooBig });
    expect(sheetLayout("5x7", at600.size).ok).toBe(true);
    expect(sheetLayout("a4", uk.size).ok).toBe(true);
  });
});

describe("JPG resolution", () => {
  const jfif = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);

  it("writes the DPI into an existing JFIF header", () => {
    const out = withJpegDpi(jfif, 300);
    expect(out.length).toBe(jfif.length);
    expect(readJpegDpi(out)).toBe(300);
    expect(readJpegDpi(jfif)).toBeUndefined();
  });

  it("adds a JFIF header when there is none", () => {
    const bare = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x02, 0xff, 0xd9]);
    const out = withJpegDpi(bare, 600);
    expect(out.length).toBe(bare.length + 18);
    expect(readJpegDpi(out)).toBe(600);
    expect([...out.subarray(20)]).toEqual([0xff, 0xe1, 0x00, 0x02, 0xff, 0xd9]);
  });
});

describe("files", () => {
  it("checks the type, the 25 MB limit and 50 megapixels", () => {
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: LIMITS.maxInputBytes })).toBe(
      undefined,
    );
    expect(checkFile({ name: "a.jpg", type: "", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooLarge("25 MB"),
    );
    expect(checkFile({ name: "a.gif", type: "image/gif", size: 1 })).toBe(MESSAGES.notAnImage);
    expect(withinPixelLimit(10_000, 5_000)).toBe(true);
    expect(withinPixelLimit(10_000, 5_001)).toBe(false);
  });

  it("names the results", () => {
    expect(outputName("me.png", "photo", "413x531")).toBe("me-passport-413x531.jpg");
    expect(outputName("me.png", "sheet", "4x6")).toBe("me-sheet-4x6.jpg");
  });
});
