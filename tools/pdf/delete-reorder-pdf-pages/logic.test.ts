import { describe, expect, it } from "vitest";
import {
  checkFile,
  checkOrder,
  checkPageCount,
  initialItems,
  isUnchanged,
  keptPages,
  LIMITS,
  MAX_PAGES,
  MESSAGES,
  moveItem,
  outputName,
  summary,
  THUMB_SIDE,
  thumbScale,
  toggleDeleted,
} from "./logic";

describe("the page list", () => {
  it("starts with every page in order, none deleted", () => {
    const items = initialItems(3);
    expect(items).toEqual([
      { page: 1, deleted: false },
      { page: 2, deleted: false },
      { page: 3, deleted: false },
    ]);
    expect(isUnchanged(items)).toBe(true);
    expect(keptPages(items)).toEqual([1, 2, 3]);
  });

  it("moves a page forward and back, clamped to the list", () => {
    const items = initialItems(4);
    expect(keptPages(moveItem(items, 0, 2))).toEqual([2, 3, 1, 4]);
    expect(keptPages(moveItem(items, 3, 0))).toEqual([4, 1, 2, 3]);
    expect(keptPages(moveItem(items, 3, 9))).toEqual([1, 2, 3, 4]);
    expect(keptPages(moveItem(items, 0, -1))).toEqual([1, 2, 3, 4]);
    expect(moveItem(items, 5, 0)).toBe(items);
    expect(isUnchanged(moveItem(items, 1, 2))).toBe(false);
  });

  it("deletes a page and keeps it again", () => {
    const deleted = toggleDeleted(initialItems(3), 1);
    expect(keptPages(deleted)).toEqual([1, 3]);
    expect(isUnchanged(deleted)).toBe(false);
    expect(keptPages(toggleDeleted(deleted, 1))).toEqual([1, 2, 3]);
  });

  it("sums up the result", () => {
    let items = initialItems(5);
    expect(summary(items)).toBe("5 pages");
    items = toggleDeleted(items, 1);
    expect(summary(items)).toBe("4 pages, 1 deleted");
    items = moveItem(items, 4, 0);
    expect(summary(items)).toBe("4 pages, 1 deleted, order changed");
    expect(summary(toggleDeleted(initialItems(2), 0))).toBe("1 page, 1 deleted");
  });
});

describe("checkOrder", () => {
  it("takes original page numbers, each once", () => {
    expect(checkOrder([3, 1, 2], 3)).toEqual({ ok: true });
    expect(checkOrder([2], 3)).toEqual({ ok: true });
  });

  it("refuses an empty order, a repeat, and a page the PDF does not have", () => {
    expect(checkOrder([], 3)).toEqual({ ok: false, error: MESSAGES.allDeleted });
    expect(checkOrder([1, 1], 3)).toEqual({ ok: false, error: MESSAGES.failed });
    expect(checkOrder([4], 3)).toEqual({ ok: false, error: MESSAGES.failed });
    expect(checkOrder([0], 3)).toEqual({ ok: false, error: MESSAGES.failed });
    expect(checkOrder([1.5], 3)).toEqual({ ok: false, error: MESSAGES.failed });
  });
});

describe("limits", () => {
  it("takes up to 200 pages, and refuses 201 and none", () => {
    expect(MAX_PAGES).toBe(200);
    expect(checkPageCount(200)).toBeUndefined();
    expect(checkPageCount(201)).toBe(MESSAGES.tooManyPages(201));
    expect(MESSAGES.tooManyPages(201)).toBe(
      "This PDF has 201 pages. This tool takes at most 200 pages; split it first.",
    );
    expect(checkPageCount(0)).toBe(MESSAGES.noPages);
  });

  it("checks the type and the 50 MB limit", () => {
    expect(checkFile({ name: "a.pdf", type: "", size: LIMITS.maxInputBytes })).toBeUndefined();
    expect(checkFile({ name: "a.pdf", type: "", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooLarge("50 MB"),
    );
    expect(checkFile({ name: "a.png", type: "image/png", size: 1 })).toBe(MESSAGES.notAPdf);
  });

  it("draws thumbnails with the longer side at 160 pixels", () => {
    expect(thumbScale(300, 400) * 400).toBe(THUMB_SIDE);
    expect(thumbScale(842, 595) * 842).toBeCloseTo(160);
    expect(thumbScale(0, 0)).toBe(1);
  });

  it("names the result", () => {
    expect(outputName("report.pdf")).toBe("report-edited.pdf");
    expect(outputName(".pdf")).toBe("document-edited.pdf");
  });
});
