import { describe, expect, it } from "vitest";
import {
  checkPage,
  checkPdf,
  checkPicture,
  EDGE,
  inkBox,
  LIMITS,
  MAX_SIGNATURE_BYTES,
  MESSAGES,
  normalRotation,
  outputName,
  placeOnPage,
  seenSize,
  signatureBox,
} from "./logic";

const letter = { width: 612, height: 792 };
const picture = { width: 400, height: 100 };

describe("signatureBox", () => {
  it("puts a 30% wide signature in the bottom right corner, half an inch from the edges", () => {
    const box = signatureBox(letter, picture, "bottom-right", "30");
    expect(box.width).toBeCloseTo(183.6);
    expect(box.height).toBeCloseTo(45.9);
    expect(box.x).toBeCloseTo(612 - EDGE - 183.6);
    expect(box.y).toBe(EDGE);
  });

  it("places every position inside the page", () => {
    for (const position of [
      "bottom-right",
      "bottom-center",
      "bottom-left",
      "top-right",
      "top-left",
      "center",
    ] as const) {
      const box = signatureBox(letter, picture, position, "40");
      expect(box.x).toBeGreaterThanOrEqual(EDGE);
      expect(box.y).toBeGreaterThanOrEqual(EDGE);
      expect(box.x + box.width).toBeLessThanOrEqual(612 - EDGE + 1e-9);
      expect(box.y + box.height).toBeLessThanOrEqual(792 - EDGE + 1e-9);
    }
    expect(signatureBox(letter, picture, "top-left", "20")).toMatchObject({ x: EDGE });
  });

  it("shrinks a tall picture to fit the page height", () => {
    const box = signatureBox(
      { width: 600, height: 100 },
      { width: 100, height: 1000 },
      "center",
      "40",
    );
    expect(box.height).toBe(100 - EDGE * 2);
    expect(box.width).toBeCloseTo(2.8);
  });
});

describe("turned pages", () => {
  it("swaps the sides of a page turned a quarter", () => {
    expect(seenSize(612, 792, 90)).toEqual({ width: 792, height: 612 });
    expect(seenSize(612, 792, 180)).toEqual({ width: 612, height: 792 });
    expect(seenSize(612, 792, -90)).toEqual({ width: 792, height: 612 });
    expect(normalRotation(-90)).toBe(270);
    expect(normalRotation(450)).toBe(90);
  });

  it("maps the seen box to the page's own coordinates, turning the picture to look upright", () => {
    const box = { x: 10, y: 20, width: 100, height: 30 };
    expect(placeOnPage(box, letter, 0)).toEqual({ ...box, rotate: 0 });
    expect(placeOnPage(box, letter, 90)).toEqual({
      x: 592,
      y: 10,
      width: 100,
      height: 30,
      rotate: 90,
    });
    expect(placeOnPage(box, letter, 180)).toEqual({
      x: 602,
      y: 772,
      width: 100,
      height: 30,
      rotate: 180,
    });
    expect(placeOnPage(box, letter, 270)).toEqual({
      x: 20,
      y: 782,
      width: 100,
      height: 30,
      rotate: 270,
    });
  });
});

describe("inkBox", () => {
  /** A width by height RGBA image, transparent but for the given opaque pixels. */
  const drawing = (width: number, height: number, ink: Array<[number, number]>) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (const [x, y] of ink) data[(y * width + x) * 4 + 3] = 255;
    return data;
  };

  it("finds the box around the ink, with a margin that stays inside the drawing", () => {
    const data = drawing(100, 50, [
      [20, 10],
      [60, 30],
    ]);
    expect(inkBox(data, 100, 50)).toEqual({ x: 16, y: 6, width: 49, height: 29 });
    expect(inkBox(drawing(10, 10, [[0, 0]]), 10, 10)).toEqual({ x: 0, y: 0, width: 5, height: 5 });
  });

  it("finds nothing in an empty drawing, and ignores faint pixels", () => {
    expect(inkBox(new Uint8ClampedArray(40), 5, 2)).toBeUndefined();
    const faint = new Uint8ClampedArray(16);
    faint[3] = 5;
    expect(inkBox(faint, 2, 2)).toBeUndefined();
  });
});

describe("files", () => {
  it("takes a PDF up to 50 MB and a PNG or JPG signature up to 5 MB", () => {
    expect(checkPdf({ name: "a.pdf", type: "application/pdf", size: LIMITS.maxInputBytes })).toBe(
      undefined,
    );
    expect(
      checkPdf({ name: "a.pdf", type: "application/pdf", size: LIMITS.maxInputBytes + 1 }),
    ).toBe(MESSAGES.tooLarge("50 MB"));
    expect(checkPdf({ name: "a.png", type: "image/png", size: 1 })).toBe(MESSAGES.notAPdf);
    expect(checkPicture({ name: "s.png", type: "image/png", size: MAX_SIGNATURE_BYTES })).toBe(
      undefined,
    );
    expect(checkPicture({ name: "s.jpg", type: "", size: 10 })).toBeUndefined();
    expect(checkPicture({ name: "s.png", type: "image/png", size: MAX_SIGNATURE_BYTES + 1 })).toBe(
      MESSAGES.pictureTooLarge,
    );
    expect(checkPicture({ name: "s.webp", type: "image/webp", size: 10 })).toBe(
      MESSAGES.notAPicture,
    );
  });

  it("checks the page number against the PDF", () => {
    expect(checkPage(1, 3)).toBeUndefined();
    expect(checkPage(3, 3)).toBeUndefined();
    expect(checkPage(4, 3)).toBe(MESSAGES.page(3));
    expect(checkPage(0, 3)).toBe(MESSAGES.page(3));
    expect(checkPage(1.5, 3)).toBe(MESSAGES.page(3));
    expect(checkPage(undefined, 3)).toBe(MESSAGES.page(3));
    expect(MESSAGES.page(1)).toBe("Choose a page from 1 to 1: this PDF has 1 page.");
  });

  it("names the signed file", () => {
    expect(outputName("contract.pdf")).toBe("contract-signed.pdf");
    expect(outputName("")).toBe("document-signed.pdf");
  });
});
