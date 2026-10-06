import { describe, expect, it } from "vitest";
import {
  checkFile,
  countWords,
  emptyPages,
  hasNoText,
  joinPieces,
  LIMITS,
  MESSAGES,
  pagesForRun,
  parsePages,
  textName,
  toText,
} from "./logic";

describe("checkFile", () => {
  it("takes a PDF of exactly 50 MB and refuses one byte more", () => {
    const pdf = { name: "a.pdf", type: "application/pdf" };
    expect(checkFile({ ...pdf, size: LIMITS.maxInputBytes })).toBeUndefined();
    expect(checkFile({ ...pdf, size: LIMITS.maxInputBytes + 1 })).toBe(MESSAGES.tooLarge("50 MB"));
  });
  it("takes a .pdf with no type, and refuses other files", () => {
    expect(checkFile({ name: "a.PDF", type: "", size: 10 })).toBeUndefined();
    expect(checkFile({ name: "a.txt", type: "text/plain", size: 10 })).toBe(MESSAGES.notAPdf);
  });
});

describe("parsePages and pagesForRun", () => {
  it("reads lists, ranges and open ranges, sorted and each once", () => {
    expect(parsePages("3, 1-2, 2, 5-", 6)).toEqual({ ok: true, pages: [1, 2, 3, 5, 6] });
    expect(parsePages(" 2 – 3 ", 4)).toEqual({ ok: true, pages: [2, 3] });
  });
  it("explains empty, bad, backwards and missing pages", () => {
    expect(parsePages(" , ", 3)).toEqual({ ok: false, error: MESSAGES.emptyPages });
    expect(parsePages("a", 3)).toEqual({ ok: false, error: MESSAGES.badPart("a") });
    expect(parsePages("0", 3)).toEqual({ ok: false, error: MESSAGES.badPart("0") });
    expect(parsePages("3-1", 3)).toEqual({ ok: false, error: MESSAGES.backwards("3-1") });
    expect(parsePages("4", 3)).toEqual({ ok: false, error: MESSAGES.outside(4, 3) });
    expect(parsePages("2-9", 3)).toEqual({ ok: false, error: MESSAGES.outside(9, 3) });
  });
  it("gives every page for all", () => {
    expect(pagesForRun("all", "", 3)).toEqual({ ok: true, pages: [1, 2, 3] });
    expect(pagesForRun("chosen", "2", 3)).toEqual({ ok: true, pages: [2] });
  });
});

describe("joinPieces", () => {
  it("joins pieces, breaks lines where PDF.js says, and trims", () => {
    expect(
      joinPieces([
        { str: "Hello", hasEOL: false },
        { str: " world  ", hasEOL: true },
        { str: "Second line", hasEOL: true },
      ]),
    ).toBe("Hello world\nSecond line");
  });
  it("keeps one blank line between paragraphs, and is empty for no pieces", () => {
    expect(
      joinPieces([
        { str: "A", hasEOL: true },
        { str: "", hasEOL: true },
        { str: "", hasEOL: true },
        { str: "", hasEOL: true },
        { str: "B", hasEOL: false },
      ]),
    ).toBe("A\n\nB");
    expect(joinPieces([])).toBe("");
  });
});

describe("the result", () => {
  const pages = [
    { page: 1, text: "One" },
    { page: 2, text: "" },
    { page: 3, text: "Three" },
  ];
  it("joins pages with a blank line, with or without page lines", () => {
    expect(toText(pages, false)).toBe("One\n\nThree\n");
    expect(toText(pages, true)).toBe(
      "--- Page 1 ---\nOne\n\n--- Page 2 ---\n\n--- Page 3 ---\nThree\n",
    );
  });
  it("says when no page has text, and which pages are empty", () => {
    expect(hasNoText(pages)).toBe(false);
    expect(hasNoText([{ page: 1, text: " \n " }])).toBe(true);
    expect(toText([{ page: 1, text: "" }], false)).toBe("");
    expect(emptyPages(pages)).toEqual([2]);
  });
  it("counts words and names the file", () => {
    expect(countWords("  one two\nthree ")).toBe(3);
    expect(countWords("   ")).toBe(0);
    expect(textName("Report.PDF")).toBe("Report.txt");
    expect(textName(".pdf")).toBe("document.txt");
  });
});
