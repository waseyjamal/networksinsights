import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  canDraw,
  checkFile,
  checkPages,
  checkPicture,
  checkText,
  clampBox,
  LIMITS,
  MESSAGES,
  moveStrokes,
  outputName,
  type PageGeometry,
  PREVIEW_MAX_SIDE,
  pictureBox,
  previewSize,
  seenSize,
  strokesBox,
  textLines,
  toPdfBox,
  toPdfPoint,
  undrawable,
} from "./logic";

const page = (rotation = 0, x = 0, y = 0): PageGeometry => ({
  x,
  y,
  width: 600,
  height: 800,
  rotation,
});

describe("the limits, at the exact boundary", () => {
  it("opens a PDF of exactly 50 MB and refuses one byte more", () => {
    const at = { name: "a.pdf", type: "application/pdf", size: LIMITS.maxInputBytes };
    expect(LIMITS.maxInputBytes).toBe(50 * 1024 * 1024);
    expect(checkFile(at)).toBeNull();
    expect(checkFile({ ...at, size: at.size + 1 })).toBe(MESSAGES.tooLarge("50 MB"));
    expect(checkFile({ name: "a.png", type: "image/png", size: 1 })).toBe(MESSAGES.notPdf);
  });

  it("opens exactly 100 pages and refuses 101, and a PDF with none", () => {
    expect(LIMITS.maxPages).toBe(100);
    expect(checkPages(100)).toBeNull();
    expect(checkPages(1)).toBeNull();
    expect(checkPages(101)).toBe(MESSAGES.tooManyPages(101));
    expect(checkPages(0)).toBe(MESSAGES.noPages);
  });

  it("takes a JPG or PNG of exactly 5 MB and refuses one byte more", () => {
    const at = { name: "a.png", type: "image/png", size: LIMITS.maxImageBytes };
    expect(checkPicture(at)).toBeNull();
    expect(checkPicture({ ...at, size: at.size + 1 })).toBe(MESSAGES.pictureTooLarge);
    expect(checkPicture({ name: "a.jpg", type: "image/jpeg", size: 1 })).toBeNull();
    expect(checkPicture({ name: "a.gif", type: "image/gif", size: 1 })).toBe(MESSAGES.notPicture);
  });

  it("takes 500 characters of text and refuses 501", () => {
    expect(checkText("a".repeat(500))).toBeNull();
    expect(checkText("a".repeat(501))).toBe(MESSAGES.textTooLong);
  });

  it("previews any page at 1,600 pixels on its longest side, never more", () => {
    expect(PREVIEW_MAX_SIDE).toBe(1600);
    expect(previewSize(612, 792)).toEqual({ width: 1236, height: 1600 });
    expect(previewSize(14400, 14400)).toEqual({ width: 1600, height: 1600 });
    expect(previewSize(14400, 10)).toEqual({ width: 1600, height: 1 });
    const { width, height } = previewSize(2384, 3370);
    expect(width * height).toBeLessThan(16_777_216);
  });
});

describe("the characters the standard fonts can draw", () => {
  it("agrees with pdf-lib for every character from U+0020 to U+2FFF, and for CJK and emoji", async () => {
    const document = await PDFDocument.create();
    for (const name of [StandardFonts.Helvetica, StandardFonts.TimesRoman, StandardFonts.Courier]) {
      const font = await document.embedFont(name);
      const codes = [
        ...Array.from({ length: 0x3000 - 0x20 }, (_, i) => 0x20 + i),
        0x4e2d,
        0x597d,
        0xac00,
        0xfb01,
        0xfffd,
        0x1f642,
      ];
      for (const code of codes) {
        const character = String.fromCodePoint(code);
        let encodes = true;
        try {
          font.encodeText(character);
        } catch {
          encodes = false;
        }
        expect(canDraw(character), `${name} U+${code.toString(16)}`).toBe(encodes);
      }
    }
  });

  it("names each character it cannot draw once, and accepts Western European text", () => {
    expect(undrawable("Café, naïve, Straße, 50 € – “quoted”")).toEqual([]);
    expect(undrawable("नमस्ते")).toEqual(["न", "म", "स", "्", "त", "े"]);
    expect(undrawable("Привет Αθήνα 你好 🙂")).toEqual([
      "П",
      "р",
      "и",
      "в",
      "е",
      "т",
      "Α",
      "θ",
      "ή",
      "ν",
      "α",
      "你",
      "好",
      "🙂",
    ]);
    expect(checkText("Hello 你好")).toBe(MESSAGES.cannotDraw("你 好"));
    expect(checkText("two\nlines")).toBeNull();
  });
});

describe("placing items on pages", () => {
  it("swaps the sides of a page turned a quarter", () => {
    expect(seenSize(page(0))).toEqual({ width: 600, height: 800 });
    expect(seenSize(page(90))).toEqual({ width: 800, height: 600 });
    expect(seenSize(page(-90))).toEqual({ width: 800, height: 600 });
    expect(seenSize(page(180))).toEqual({ width: 600, height: 800 });
  });

  it("maps the seen top left corner to the right corner of the PDF for every turn", () => {
    // The top left as seen is, in the page's own coordinates of a 600 by 800 page:
    expect(toPdfPoint(0, 0, page(0))).toEqual({ x: 0, y: 800 });
    expect(toPdfPoint(0, 0, page(90))).toEqual({ x: 0, y: 0 });
    expect(toPdfPoint(0, 0, page(180))).toEqual({ x: 600, y: 0 });
    expect(toPdfPoint(0, 0, page(270))).toEqual({ x: 600, y: 800 });
    // And the bottom right as seen is the opposite corner.
    expect(toPdfPoint(1, 1, page(0))).toEqual({ x: 600, y: 0 });
    expect(toPdfPoint(1, 1, page(90))).toEqual({ x: 600, y: 800 });
  });

  it("adds the crop box's offset", () => {
    expect(toPdfPoint(0.5, 0.5, page(0, 36, 72))).toEqual({ x: 336, y: 472 });
  });

  it("gives boxes their seen bottom left corner, size in points and turn", () => {
    const box = { x: 0.1, y: 0.2, width: 0.5, height: 0.25 };
    const round = (value: Record<string, number>) =>
      Object.fromEntries(
        Object.entries(value).map(([key, n]) => [key, Math.round(n * 1000) / 1000]),
      );
    expect(round(toPdfBox(box, page(0)))).toEqual({
      x: 60,
      y: 440,
      width: 300,
      height: 200,
      rotate: 0,
    });
    // Turned 90: seen 800 wide, 600 high. Seen bottom left (80, 330) maps to (600 - 330, 80).
    expect(round(toPdfBox(box, page(90)))).toEqual({
      x: 270,
      y: 80,
      width: 400,
      height: 150,
      rotate: 90,
    });
  });

  it("puts each line of text a line height below the one before", () => {
    const item = {
      kind: "text" as const,
      id: "t",
      page: 1,
      x: 0.1,
      y: 0.1,
      text: "one\ntwo",
      font: "helvetica" as const,
      size: 20,
      color: "black" as const,
    };
    const [first, second] = textLines(item, page(0));
    expect(first).toMatchObject({ line: "one", x: 60, rotate: 0 });
    expect(first?.y).toBeCloseTo(800 - 80 - 18);
    expect(second?.y).toBeCloseTo(800 - 80 - 18 - 24);
  });

  it("keeps boxes on the page", () => {
    expect(clampBox({ x: 0.9, y: -0.2, width: 0.3, height: 0.1 })).toEqual({
      x: 0.7,
      y: 0,
      width: 0.3,
      height: 0.1,
    });
    expect(clampBox({ x: 0, y: 0, width: 2, height: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 0.01,
    });
  });

  it("sizes a picture by page width and keeps its shape", () => {
    const box = pictureBox({ width: 200, height: 100 }, { width: 600, height: 800 }, 0.5);
    expect(box.width).toBe(0.5);
    expect(box.height * 800).toBeCloseTo(150);
  });

  it("boxes and moves drawings", () => {
    const strokes = [
      [
        { x: 0.2, y: 0.3 },
        { x: 0.4, y: 0.5 },
      ],
    ];
    expect(strokesBox(strokes)).toEqual({ x: 0.2, y: 0.3, width: 0.2, height: 0.2 });
    expect(strokesBox(moveStrokes(strokes, 0.1, -0.1)).x).toBeCloseTo(0.3);
    expect(strokesBox([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

it("names the result after the original", () => {
  expect(outputName("contract.pdf")).toBe("contract-edited.pdf");
  expect(outputName(".pdf")).toBe("document-edited.pdf");
});
