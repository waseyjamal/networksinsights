import { describe, expect, it } from "vitest";
import {
  checkFile,
  ENGINE_BYTES,
  firstDownloadBytes,
  formatSize,
  inputKindOf,
  isEmptyResult,
  joinPages,
  LANGUAGES,
  LIMITS,
  languagesOf,
  MAX_PAGES,
  MAX_SIDE,
  MESSAGES,
  pdfScale,
  readSize,
  textName,
  tidyText,
  withinPageLimit,
} from "./logic";

describe("checkFile", () => {
  const file = (name: string, type = "", size = 1000) => ({ name, type, size });

  it("takes photos and PDFs, by type or by extension", () => {
    expect(inputKindOf(file("scan.png", "image/png"))).toBe("image");
    expect(inputKindOf(file("scan.jpeg"))).toBe("image");
    expect(inputKindOf(file("scan.webp"))).toBe("image");
    expect(inputKindOf(file("letter.pdf"))).toBe("pdf");
    expect(inputKindOf(file("letter", "application/pdf"))).toBe("pdf");
    expect(inputKindOf(file("photo.heic", "image/heic"))).toBeUndefined();
    expect(inputKindOf(file("notes.txt", "text/plain"))).toBeUndefined();
  });

  it("allows a file of exactly 20 MB and refuses one byte more", () => {
    expect(checkFile(file("exact.png", "image/png", LIMITS.maxInputBytes))).toEqual({
      ok: true,
      kind: "image",
    });
    expect(checkFile(file("over.pdf", "application/pdf", LIMITS.maxInputBytes + 1))).toEqual({
      ok: false,
      error: "This file is larger than 20 MB.",
    });
  });

  it("refuses other files with the reason", () => {
    expect(checkFile(file("notes.txt", "text/plain"))).toEqual({
      ok: false,
      error: MESSAGES.unsupported,
    });
  });
});

describe("the page limit", () => {
  it("allows exactly 20 pages and refuses 21", () => {
    expect(withinPageLimit(MAX_PAGES)).toBe(true);
    expect(withinPageLimit(MAX_PAGES + 1)).toBe(false);
    expect(withinPageLimit(0)).toBe(false);
    expect(MESSAGES.tooManyPages(21)).toBe(
      "This PDF has 21 pages. Up to 20 pages can be read at a time: split it first, for example with Split PDF.",
    );
  });
});

describe("readSize and pdfScale", () => {
  it("keeps a photo of 4,000 pixels and scales a larger one down to 4,000", () => {
    expect(readSize(4000, 3000)).toEqual({ width: 4000, height: 3000 });
    expect(readSize(4001, 3000)).toEqual({ width: 4000, height: 2999 });
    expect(readSize(3000, 8000)).toEqual({ width: 1500, height: 4000 });
  });

  it("draws an A4 page at 300 dpi, and a poster within 4,000 pixels", () => {
    // A4 is 595.28 by 841.89 points: 300 dpi gives 2,480 by 3,508 pixels.
    expect(Math.round(841.89 * pdfScale(595.28, 841.89))).toBe(3508);
    expect(Math.round(2384 * pdfScale(1684, 2384))).toBe(MAX_SIDE);
  });
});

describe("languages and download sizes", () => {
  it("downloads only the chosen language data", () => {
    expect(languagesOf("eng")).toEqual(["eng"]);
    expect(languagesOf("hin")).toEqual(["hin"]);
    expect(languagesOf("both")).toEqual(["eng", "hin"]);
    expect(firstDownloadBytes("eng")).toBe(ENGINE_BYTES + LANGUAGES.eng.bytes);
    expect(firstDownloadBytes("both")).toBe(
      ENGINE_BYTES + LANGUAGES.eng.bytes + LANGUAGES.hin.bytes,
    );
  });

  it("shows the sizes as a person reads them", () => {
    expect(formatSize(LANGUAGES.eng.bytes)).toBe("2.8 MB");
    expect(formatSize(LANGUAGES.hin.bytes)).toBe("1.3 MB");
    expect(formatSize(ENGINE_BYTES)).toBe("3.5 MB");
  });
});

describe("the text", () => {
  it("tidies spaces and blank lines", () => {
    expect(tidyText("  Hello  \r\n\r\n\r\n\nworld \n")).toBe("Hello\n\nworld");
  });

  it("gives a photo's text alone, and heads each PDF page", () => {
    expect(joinPages([{ page: 1, text: "Receipt\n" }], "image")).toBe("Receipt");
    expect(
      joinPages(
        [
          { page: 1, text: "First\n" },
          { page: 2, text: "Second" },
        ],
        "pdf",
      ),
    ).toBe("Page 1\n\nFirst\n\nPage 2\n\nSecond");
  });

  it("knows when nothing was found", () => {
    expect(isEmptyResult([{ page: 1, text: " \n\n" }])).toBe(true);
    expect(isEmptyResult([{ page: 1, text: "a" }])).toBe(false);
  });

  it("names the text file after the input", () => {
    expect(textName("receipt.jpg")).toBe("receipt.txt");
    expect(textName("letter.pdf")).toBe("letter.txt");
  });
});
