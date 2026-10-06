import { describe, expect, it } from "vitest";
import {
  boxFrom,
  boxPixels,
  checkBoxes,
  checkFile,
  checkPages,
  LIMITS,
  MESSAGES,
  moveBox,
  outputName,
  redactedPages,
  renderSize,
} from "./logic";

describe("files and pages", () => {
  it("takes a PDF of exactly 50 MB and refuses one byte more", () => {
    const pdf = { name: "a.pdf", type: "application/pdf" };
    expect(checkFile({ ...pdf, size: LIMITS.maxInputBytes })).toBeNull();
    expect(checkFile({ ...pdf, size: LIMITS.maxInputBytes + 1 })).toBe(MESSAGES.tooLarge("50 MB"));
    expect(checkFile({ name: "a.doc", type: "application/msword", size: 1 })).toBe(MESSAGES.notPdf);
  });
  it("opens 1 to 100 pages", () => {
    expect(checkPages(100)).toBeNull();
    expect(checkPages(101)).toBe(MESSAGES.tooManyPages(101));
    expect(checkPages(0)).toBe(MESSAGES.noPages);
  });
});

describe("boxes", () => {
  it("makes a box from the corners of a drag, either way round, kept on the page", () => {
    expect(
      boxFrom("a", 2, [
        { x: 0.6, y: 0.5 },
        { x: 0.4, y: 0.3 },
        { x: 1.2, y: 0.4 },
      ]),
    ).toEqual({
      id: "a",
      page: 2,
      x: 0.4,
      y: 0.3,
      width: 0.6,
      height: 0.2,
    });
    expect(boxFrom("b", 1, [{ x: 0.5, y: 0.5 }])).toBeNull();
    expect(
      boxFrom("c", 1, [
        { x: 0.5, y: 0.5 },
        { x: 0.502, y: 0.7 },
      ]),
    ).toBeNull();
  });
  it("keeps a moved box wholly on the page", () => {
    const box = { id: "a", page: 1, x: 0, y: 0, width: 0.3, height: 0.2 };
    expect(moveBox(box, 0.9, -1)).toMatchObject({ x: 0.7, y: 0 });
  });
  it("lists redacted pages, and needs at least one box and at most 50 a page", () => {
    const box = (page: number, id = String(page)) => ({
      id,
      page,
      x: 0,
      y: 0,
      width: 0.1,
      height: 0.1,
    });
    expect(redactedPages([box(3), box(1), box(3, "x")])).toEqual([1, 3]);
    expect(checkBoxes([])).toBe(MESSAGES.noBoxes);
    const fifty = Array.from({ length: 50 }, (_, index) => box(1, String(index)));
    expect(checkBoxes(fifty)).toBeNull();
    expect(checkBoxes([...fifty, box(1, "51")])).toBe(MESSAGES.tooManyBoxes);
  });
});

describe("drawing", () => {
  it("draws A4 at 150 dpi, and a poster at most 4,096 pixels", () => {
    expect(renderSize(595.28, 841.89, 4096, 150)).toEqual({ width: 1240, height: 1754 });
    expect(renderSize(2384, 3370, 4096, 150).height).toBe(4096);
  });
  it("grows a box to whole pixels", () => {
    expect(
      boxPixels({ id: "a", page: 1, x: 0.101, y: 0.2, width: 0.3, height: 0.2 }, 100, 50),
    ).toEqual({
      x: 10,
      y: 10,
      width: 31,
      height: 10,
    });
    expect(outputName("Contract.PDF")).toBe("Contract-redacted.pdf");
  });
});
