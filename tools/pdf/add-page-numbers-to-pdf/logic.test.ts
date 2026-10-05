import { describe, expect, it } from "vitest";
import {
  checkFile,
  LIMITS,
  MESSAGES,
  normalRotation,
  numberText,
  outputName,
  type PageBox,
  parsePages,
  parseWhole,
  placeText,
  planStamps,
  type Settings,
} from "./logic";

const base: Settings = {
  format: "number",
  start: "1",
  firstPage: "1",
  fontSize: "11",
  margin: "36",
  which: "all",
  pages: "",
};

const texts = (settings: Partial<Settings>, pages: number) => {
  const plan = planStamps({ ...base, ...settings }, pages);
  return plan.ok ? plan.stamps.map((stamp) => `${stamp.page}:${stamp.text}`) : plan.error;
};

describe("planStamps", () => {
  it("numbers every page from 1 by default", () => {
    expect(texts({}, 3)).toEqual(["1:1", "2:2", "3:3"]);
  });

  it("writes each format", () => {
    expect(texts({ format: "page" }, 2)).toEqual(["1:Page 1", "2:Page 2"]);
    expect(texts({ format: "of" }, 2)).toEqual(["1:1 of 2", "2:2 of 2"]);
    expect(numberText("of", 7, 12)).toBe("7 of 12");
  });

  it("starts on a later page with a chosen number, and N follows", () => {
    // Page 3 carries 1; a 10-page PDF then ends on 8.
    expect(texts({ firstPage: "3", format: "of" }, 10)).toEqual([
      "3:1 of 8",
      "4:2 of 8",
      "5:3 of 8",
      "6:4 of 8",
      "7:5 of 8",
      "8:6 of 8",
      "9:7 of 8",
      "10:8 of 8",
    ]);
    expect(texts({ start: "5" }, 2)).toEqual(["1:5", "2:6"]);
    expect(texts({ start: "0" }, 2)).toEqual(["1:0", "2:1"]);
  });

  it("draws only on chosen pages, which still count", () => {
    expect(texts({ which: "chosen", pages: "2, 4-" }, 5)).toEqual(["2:2", "4:4", "5:5"]);
    expect(texts({ which: "chosen", pages: "1-2", firstPage: "3" }, 5)).toBe(MESSAGES.nothing);
    expect(texts({ which: "chosen", pages: "9" }, 5)).toBe(MESSAGES.outside(9, 5));
  });

  it("checks every number at its limits", () => {
    expect(texts({ start: "99,999" }, 1)).toEqual(["1:99999"]);
    expect(texts({ start: "100000" }, 1)).toBe(MESSAGES.start);
    expect(texts({ start: "-1" }, 1)).toBe(MESSAGES.start);
    expect(texts({ start: "1.5" }, 1)).toBe(MESSAGES.start);
    expect(texts({ firstPage: "0" }, 4)).toBe(MESSAGES.firstPage(4));
    expect(texts({ firstPage: "5" }, 4)).toBe(MESSAGES.firstPage(4));
    expect(texts({ firstPage: "4" }, 4)).toEqual(["4:1"]);
    expect(texts({ fontSize: "6" }, 1)).toEqual(["1:1"]);
    expect(texts({ fontSize: "72" }, 1)).toEqual(["1:1"]);
    expect(texts({ fontSize: "5" }, 1)).toBe(MESSAGES.fontSize);
    expect(texts({ fontSize: "73" }, 1)).toBe(MESSAGES.fontSize);
    expect(texts({ margin: "0" }, 1)).toEqual(["1:1"]);
    expect(texts({ margin: "144" }, 1)).toEqual(["1:1"]);
    expect(texts({ margin: "145" }, 1)).toBe(MESSAGES.margin);
    expect(texts({ margin: "" }, 1)).toBe(MESSAGES.margin);
  });
});

describe("placeText", () => {
  const box: PageBox = { x: 0, y: 0, width: 300, height: 400, rotation: 0 };

  it("puts the number at each corner and edge of an upright page", () => {
    expect(placeText(box, "bottom-center", 20, 10, 36)).toEqual({ x: 140, y: 36, rotate: 0 });
    expect(placeText(box, "bottom-left", 20, 10, 36)).toEqual({ x: 36, y: 36, rotate: 0 });
    expect(placeText(box, "bottom-right", 20, 10, 36)).toEqual({ x: 244, y: 36, rotate: 0 });
    expect(placeText(box, "top-left", 20, 10, 36)).toEqual({ x: 36, y: 356.8, rotate: 0 });
  });

  it("follows the page box when it does not start at zero", () => {
    expect(placeText({ ...box, x: 10, y: 20 }, "bottom-left", 20, 10, 0)).toEqual({
      x: 10,
      y: 20,
      rotate: 0,
    });
  });

  it("keeps the number upright at the bottom of a turned page as it is shown", () => {
    // Turned 90° clockwise, the page is seen 400 wide; its bottom edge is the page's x = 300 side.
    expect(placeText({ ...box, rotation: 90 }, "bottom-left", 20, 10, 36)).toEqual({
      x: 264,
      y: 36,
      rotate: 90,
    });
    expect(placeText({ ...box, rotation: 180 }, "bottom-left", 20, 10, 36)).toEqual({
      x: 264,
      y: 364,
      rotate: 180,
    });
    expect(placeText({ ...box, rotation: 270 }, "bottom-left", 20, 10, 36)).toEqual({
      x: 36,
      y: 364,
      rotate: 270,
    });
    expect(normalRotation(-90)).toBe(270);
    expect(normalRotation(450)).toBe(90);
  });
});

describe("input and files", () => {
  it("reads whole numbers", () => {
    expect(parseWhole(" 12 ")).toBe(12);
    expect(parseWhole("1,000")).toBe(1000);
    expect(parseWhole("")).toBeUndefined();
    expect(parseWhole("1e3")).toBeUndefined();
  });

  it("reads pages", () => {
    expect(parsePages("3-4, 1", 5)).toEqual({ ok: true, pages: [1, 3, 4] });
    expect(parsePages("", 5)).toEqual({ ok: false, error: MESSAGES.emptyPages });
    expect(parsePages("4-2", 5)).toEqual({ ok: false, error: MESSAGES.backwards("4-2") });
  });

  it("checks the type and the 50 MB limit", () => {
    expect(checkFile({ name: "a.pdf", type: "", size: LIMITS.maxInputBytes })).toBeUndefined();
    expect(checkFile({ name: "a.pdf", type: "", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooLarge("50 MB"),
    );
    expect(checkFile({ name: "a.txt", type: "text/plain", size: 1 })).toBe(MESSAGES.notAPdf);
  });

  it("names the result", () => {
    expect(outputName("report.pdf")).toBe("report-numbered.pdf");
  });
});
