import { describe, expect, it } from "vitest";
import {
  checkFile,
  cleanValues,
  emptyValues,
  formatDate,
  LIMITS,
  MESSAGES,
  outputName,
} from "./logic";

describe("values", () => {
  it("trims values and turns line breaks into spaces", () => {
    expect(
      cleanValues({ ...emptyValues(), title: "  Annual\r\nreport  ", keywords: "a\tb" }),
    ).toEqual({ ok: true, values: { ...emptyValues(), title: "Annual report", keywords: "a b" } });
  });

  it("keeps an empty value empty, which removes the field", () => {
    expect(cleanValues({ ...emptyValues(), author: "   " })).toEqual({
      ok: true,
      values: emptyValues(),
    });
  });

  it("refuses a value over the limit and takes one at it", () => {
    const at = "x".repeat(LIMITS.maxFieldChars);
    expect(cleanValues({ ...emptyValues(), subject: at }).ok).toBe(true);
    expect(cleanValues({ ...emptyValues(), creator: `${at}x` })).toEqual({
      ok: false,
      error: MESSAGES.tooLong("creator"),
    });
    expect(MESSAGES.tooLong("creator")).toBe("Creator is longer than 2000 characters.");
  });

  it("keeps characters outside Latin-1", () => {
    expect(cleanValues({ ...emptyValues(), title: "Résumé 東京 ✓" })).toEqual({
      ok: true,
      values: { ...emptyValues(), title: "Résumé 東京 ✓" },
    });
  });
});

describe("display", () => {
  it("formats dates in UTC and leaves a missing date empty", () => {
    expect(formatDate("2024-03-05T10:20:30.000Z")).toBe("2024-03-05 10:20:30 UTC");
    expect(formatDate("")).toBe("");
  });

  it("names the result and checks the file", () => {
    expect(outputName("report.pdf")).toBe("report-metadata.pdf");
    expect(outputName("")).toBe("document-metadata.pdf");
    const pdf = { name: "a.pdf", type: "application/pdf" };
    expect(checkFile({ ...pdf, size: LIMITS.maxInputBytes })).toBeUndefined();
    expect(checkFile({ ...pdf, size: LIMITS.maxInputBytes + 1 })).toBe(MESSAGES.tooLarge("50 MB"));
    expect(checkFile({ name: "a.txt", type: "text/plain", size: 1 })).toBe(MESSAGES.notAPdf);
  });
});
