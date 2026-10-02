import { describe, expect, it } from "vitest";
import {
  checkFile,
  everyPage,
  indicesOf,
  LIMITS,
  MESSAGES,
  parseRanges,
  partName,
  rangeLabel,
} from "./logic";

describe("parseRanges", () => {
  it("reads pages and ranges, each part its own range", () => {
    expect(parseRanges("1-3, 5, 8-10", 10)).toEqual({
      ok: true,
      ranges: [
        { from: 1, to: 3 },
        { from: 5, to: 5 },
        { from: 8, to: 10 },
      ],
    });
  });

  it("runs an open range to the last page, and takes spaces, semicolons and dashes", () => {
    expect(parseRanges(" 8 - ", 12)).toEqual({ ok: true, ranges: [{ from: 8, to: 12 }] });
    expect(parseRanges("2–4; 6", 6)).toEqual({
      ok: true,
      ranges: [
        { from: 2, to: 4 },
        { from: 6, to: 6 },
      ],
    });
    expect(parseRanges("1,,2,", 2).ok).toBe(true);
  });

  it("takes the first and the last page exactly", () => {
    expect(parseRanges("1-6", 6)).toEqual({ ok: true, ranges: [{ from: 1, to: 6 }] });
    expect(parseRanges("6", 6).ok).toBe(true);
  });

  it("refuses pages outside the PDF, naming the page and the count", () => {
    expect(parseRanges("7", 6)).toEqual({ ok: false, error: MESSAGES.outside(7, 6) });
    expect(parseRanges("4-9", 6)).toEqual({ ok: false, error: MESSAGES.outside(9, 6) });
    expect(MESSAGES.outside(2, 1)).toBe("Page 2 does not exist: this PDF has 1 page.");
  });

  it("refuses empty, backwards, zero and unreadable parts", () => {
    expect(parseRanges(" , ", 5)).toEqual({ ok: false, error: MESSAGES.emptyRanges });
    expect(parseRanges("5-3", 5)).toEqual({ ok: false, error: MESSAGES.backwards("5-3") });
    expect(parseRanges("0", 5)).toEqual({ ok: false, error: MESSAGES.badPart("0") });
    expect(parseRanges("one", 5)).toEqual({ ok: false, error: MESSAGES.badPart("one") });
    expect(parseRanges("-3", 5)).toEqual({ ok: false, error: MESSAGES.badPart("-3") });
    expect(parseRanges("1-2-3", 5)).toEqual({ ok: false, error: MESSAGES.badPart("1-2-3") });
  });
});

describe("parts", () => {
  it("makes one range a page for Every page", () => {
    expect(everyPage(3)).toEqual([
      { from: 1, to: 1 },
      { from: 2, to: 2 },
      { from: 3, to: 3 },
    ]);
    expect(everyPage(0)).toEqual([]);
  });

  it("turns a range into pdf-lib page indices", () => {
    expect(indicesOf({ from: 2, to: 4 })).toEqual([1, 2, 3]);
    expect(indicesOf({ from: 1, to: 1 })).toEqual([0]);
  });

  it("names and labels each part", () => {
    expect(partName("report.pdf", { from: 2, to: 4 })).toBe("report-pages-2-4.pdf");
    expect(partName("report.PDF", { from: 5, to: 5 })).toBe("report-page-5.pdf");
    expect(partName(".pdf", { from: 1, to: 1 })).toBe("document-page-1.pdf");
    expect(rangeLabel({ from: 2, to: 4 })).toBe("Pages 2 to 4");
    expect(rangeLabel({ from: 5, to: 5 })).toBe("Page 5");
  });

  it("checks the file type and the 50 MB limit", () => {
    expect(checkFile({ name: "a.pdf", type: "application/pdf", size: LIMITS.maxInputBytes })).toBe(
      undefined,
    );
    expect(
      checkFile({ name: "a.pdf", type: "application/pdf", size: LIMITS.maxInputBytes + 1 }),
    ).toBe(MESSAGES.tooLarge("50 MB"));
    expect(checkFile({ name: "a.docx", type: "application/msword", size: 1 })).toBe(
      MESSAGES.notAPdf,
    );
  });
});
