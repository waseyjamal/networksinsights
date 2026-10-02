import { describe, expect, it } from "vitest";
import {
  allPages,
  checkFile,
  LIMITS,
  MESSAGES,
  outputName,
  pagesLabel,
  parsePages,
  turned,
} from "./logic";

describe("parsePages", () => {
  it("reads pages and ranges into one sorted list, each page once", () => {
    expect(parsePages("3-4, 1, 4", 5)).toEqual({ ok: true, pages: [1, 3, 4] });
    expect(parsePages("4-", 6)).toEqual({ ok: true, pages: [4, 5, 6] });
    expect(parsePages("1–2", 2)).toEqual({ ok: true, pages: [1, 2] });
  });

  it("refuses pages the PDF does not have, and text that is not pages", () => {
    expect(parsePages("6", 5)).toEqual({ ok: false, error: MESSAGES.outside(6, 5) });
    expect(parsePages("2-8", 5)).toEqual({ ok: false, error: MESSAGES.outside(8, 5) });
    expect(parsePages("", 5)).toEqual({ ok: false, error: MESSAGES.emptyPages });
    expect(parsePages("4-2", 5)).toEqual({ ok: false, error: MESSAGES.backwards("4-2") });
    expect(parsePages("0", 5)).toEqual({ ok: false, error: MESSAGES.badPart("0") });
    expect(parsePages("all", 5)).toEqual({ ok: false, error: MESSAGES.badPart("all") });
  });
});

describe("turned", () => {
  it("adds the turn and stays within 0 to 270", () => {
    expect(turned(0, "90")).toBe(90);
    expect(turned(90, "90")).toBe(180);
    expect(turned(270, "90")).toBe(0);
    expect(turned(0, "270")).toBe(270);
    expect(turned(180, "180")).toBe(0);
    expect(turned(-90, "90")).toBe(0);
    expect(turned(-90, "180")).toBe(90);
  });
});

describe("files and names", () => {
  it("lists every page", () => {
    expect(allPages(3)).toEqual([1, 2, 3]);
  });

  it("checks the type and the 50 MB limit", () => {
    expect(checkFile({ name: "a.pdf", type: "", size: LIMITS.maxInputBytes })).toBeUndefined();
    expect(checkFile({ name: "a.pdf", type: "", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooLarge("50 MB"),
    );
    expect(checkFile({ name: "a.png", type: "image/png", size: 1 })).toBe(MESSAGES.notAPdf);
  });

  it("names the result and counts pages", () => {
    expect(outputName("scan.pdf")).toBe("scan-rotated.pdf");
    expect(outputName("")).toBe("document-rotated.pdf");
    expect(pagesLabel(1)).toBe("1 page");
  });
});
