import { describe, expect, it } from "vitest";
import {
  boxMargins,
  checkFile,
  cropBox,
  formatMm,
  keptArea,
  LIMITS,
  MESSAGES,
  normalRotation,
  outputName,
  POINTS_PER_MM,
  parseMargins,
  seenSize,
} from "./logic";

const pt = (mm: number) => mm * POINTS_PER_MM;
const A4 = { x: 0, y: 0, width: 595.28, height: 841.89 };

describe("margins", () => {
  it("reads millimetres as points, with a comma or a point", () => {
    const parsed = parseMargins({ top: "20", right: "10,5", bottom: "", left: " 0 " });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.margins.top).toBeCloseTo(56.693, 3);
    expect(parsed.margins.right).toBeCloseTo(29.764, 3);
    expect(parsed.margins.bottom).toBe(0);
    expect(parsed.margins.left).toBe(0);
  });

  it("refuses bad, negative, too large and all-zero margins", () => {
    expect(parseMargins({ top: "abc", right: "", bottom: "", left: "" })).toEqual({
      ok: false,
      error: MESSAGES.badMargin("top"),
    });
    expect(parseMargins({ top: "", right: "-1", bottom: "", left: "" })).toEqual({
      ok: false,
      error: MESSAGES.badMargin("right"),
    });
    expect(parseMargins({ top: "", right: "", bottom: "1001", left: "" })).toEqual({
      ok: false,
      error: MESSAGES.badMargin("bottom"),
    });
    expect(parseMargins({ top: "0", right: "", bottom: "0.0", left: "" })).toEqual({
      ok: false,
      error: MESSAGES.nothing,
    });
  });
});

describe("the new page box", () => {
  const cut = { top: pt(20), right: pt(10), bottom: pt(10), left: pt(10) };

  it("cuts an upright A4 page to 190 by 267 mm", () => {
    const box = cropBox(A4, 0, cut);
    expect(box).not.toBeNull();
    expect(formatMm(box?.width ?? 0)).toBe("190.0 mm");
    expect(formatMm(box?.height ?? 0)).toBe("267.0 mm");
    expect(box?.x).toBeCloseTo(pt(10), 6);
    expect(box?.y).toBeCloseTo(pt(10), 6);
  });

  it("keeps the origin of the original box", () => {
    const box = cropBox({ x: 100, y: 50, width: 300, height: 400 }, 0, {
      top: 10,
      right: 20,
      bottom: 30,
      left: 40,
    });
    expect(box).toEqual({ x: 140, y: 80, width: 240, height: 360 });
  });

  it("maps the seen sides to the box at every rotation", () => {
    const seen = { top: 1, right: 2, bottom: 3, left: 4 };
    expect(boxMargins(seen, 0)).toEqual(seen);
    expect(boxMargins(seen, 90)).toEqual({ left: 1, top: 2, right: 3, bottom: 4 });
    expect(boxMargins(seen, 180)).toEqual({ bottom: 1, left: 2, top: 3, right: 4 });
    expect(boxMargins(seen, 270)).toEqual({ right: 1, bottom: 2, left: 3, top: 4 });
    expect(boxMargins(seen, -90)).toEqual(boxMargins(seen, 270));
    expect(normalRotation(450)).toBe(90);
  });

  it("a page turned 90 degrees loses its seen top from the left of its box", () => {
    const box = cropBox({ x: 0, y: 0, width: 400, height: 300 }, 90, {
      top: 50,
      right: 0,
      bottom: 0,
      left: 0,
    });
    expect(box).toEqual({ x: 50, y: 0, width: 350, height: 300 });
  });

  it("refuses margins that leave less than 10 points", () => {
    const square = { x: 0, y: 0, width: 100, height: 100 };
    expect(cropBox(square, 0, { top: 45, bottom: 45.1, left: 0, right: 0 })).toBeNull();
    expect(cropBox(square, 0, { top: 45, bottom: 45, left: 0, right: 0 })).toEqual({
      x: 0,
      y: 45,
      width: 100,
      height: 10,
    });
  });
});

describe("the size as seen", () => {
  it("swaps width and height for a quarter turn", () => {
    const box = { x: 0, y: 0, width: 400, height: 300 };
    expect(seenSize(box, 0)).toEqual({ width: 400, height: 300 });
    expect(seenSize(box, 90)).toEqual({ width: 300, height: 400 });
    expect(seenSize(box, 180)).toEqual({ width: 400, height: 300 });
    expect(seenSize(box, 270)).toEqual({ width: 300, height: 400 });
  });
});

describe("the preview outline", () => {
  it("is the kept part of the page, from the top left", () => {
    expect(keptArea(200, 400, { top: 40, right: 20, bottom: 0, left: 20 })).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.9,
    });
    expect(keptArea(100, 100, { top: 90, right: 0, bottom: 90, left: 0 }).height).toBe(0);
  });
});

describe("files", () => {
  it("accepts a PDF up to the limit and names the result", () => {
    const pdf = { name: "a.pdf", type: "application/pdf" };
    expect(checkFile({ ...pdf, size: LIMITS.maxInputBytes })).toBeUndefined();
    expect(checkFile({ ...pdf, size: LIMITS.maxInputBytes + 1 })).toBe(MESSAGES.tooLarge("50 MB"));
    expect(checkFile({ name: "a.png", type: "image/png", size: 1 })).toBe(MESSAGES.notAPdf);
    expect(checkFile({ name: "a.PDF", type: "", size: 1 })).toBeUndefined();
    expect(outputName("scan.PDF")).toBe("scan-cropped.pdf");
    expect(outputName(".pdf")).toBe("document-cropped.pdf");
  });
});
