import { describe, expect, it } from "vitest";
import {
  checkFile,
  LIMITS,
  MAX_PAGES_PER_RUN,
  MAX_SIDE,
  MESSAGES,
  pagesForRun,
  parsePages,
  pictureName,
  pictureSize,
  renderScale,
} from "./logic";

describe("renderScale and pictureSize", () => {
  it("draws an A4 page at the chosen resolution", () => {
    // A4 is 595.28 by 841.89 points.
    expect(pictureSize(595.28, 841.89, renderScale(595.28, 841.89, "96"))).toEqual({
      width: 793,
      height: 1122,
    });
    expect(pictureSize(595.28, 841.89, renderScale(595.28, 841.89, "150"))).toEqual({
      width: 1240,
      height: 1753,
    });
    expect(pictureSize(595.28, 841.89, renderScale(595.28, 841.89, "300"))).toEqual({
      width: 2480,
      height: 3507,
    });
  });

  it("caps the longer side at 4,096 pixels, so the area stays within 16,777,216", () => {
    // An A0 poster, 2384 by 3370 points, at 300 dpi would be 9933 by 14041 pixels.
    const size = pictureSize(2384, 3370, renderScale(2384, 3370, "300"));
    expect(size.height).toBe(MAX_SIDE);
    expect(size.width).toBeLessThanOrEqual(MAX_SIDE);
    expect(size.width * size.height).toBeLessThanOrEqual(16_777_216);
    // A very long strip is capped on its long side too.
    const strip = pictureSize(100_000, 10, renderScale(100_000, 10, "96"));
    expect(strip).toEqual({ width: MAX_SIDE, height: 1 });
  });
});

describe("pages for a run", () => {
  it("takes all pages, or the chosen ones", () => {
    expect(pagesForRun("all", "", 3)).toEqual({ ok: true, pages: [1, 2, 3] });
    expect(pagesForRun("chosen", "3, 1", 3)).toEqual({ ok: true, pages: [1, 3] });
    expect(parsePages("2-", 4)).toEqual({ ok: true, pages: [2, 3, 4] });
  });

  it("takes 50 pages and refuses 51, with the count", () => {
    expect(pagesForRun("all", "", MAX_PAGES_PER_RUN).ok).toBe(true);
    expect(pagesForRun("all", "", 51)).toEqual({ ok: false, error: MESSAGES.tooManyPages(51) });
    expect(pagesForRun("chosen", "1-51", 60)).toEqual({
      ok: false,
      error: MESSAGES.tooManyPages(51),
    });
  });

  it("refuses pages outside the PDF and text that is not pages", () => {
    expect(pagesForRun("chosen", "9", 8)).toEqual({ ok: false, error: MESSAGES.outside(9, 8) });
    expect(pagesForRun("chosen", "", 8)).toEqual({ ok: false, error: MESSAGES.emptyPages });
    expect(pagesForRun("chosen", "3-1", 8)).toEqual({
      ok: false,
      error: MESSAGES.backwards("3-1"),
    });
  });
});

describe("files and names", () => {
  it("checks the type and the 50 MB limit", () => {
    expect(checkFile({ name: "a.pdf", type: "application/pdf", size: LIMITS.maxInputBytes })).toBe(
      undefined,
    );
    expect(
      checkFile({ name: "a.pdf", type: "application/pdf", size: LIMITS.maxInputBytes + 1 }),
    ).toBe(MESSAGES.tooLarge("50 MB"));
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: 1 })).toBe(MESSAGES.notAPdf);
  });

  it("names each picture after the PDF and the page", () => {
    expect(pictureName("report.pdf", 3)).toBe("report-page-3.jpg");
    expect(pictureName(".pdf", 1)).toBe("document-page-1.jpg");
  });
});
