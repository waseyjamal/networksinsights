import { describe, expect, it } from "vitest";
import { checkFile, checkPassword, LIMITS, MESSAGES, unlockedName, verified } from "./logic";

describe("checkFile", () => {
  it("takes a PDF of exactly 50 MB and refuses one byte more", () => {
    const pdf = { name: "a.pdf", type: "application/pdf" };
    expect(checkFile({ ...pdf, size: LIMITS.maxInputBytes })).toBeUndefined();
    expect(checkFile({ ...pdf, size: LIMITS.maxInputBytes + 1 })).toBe(MESSAGES.tooLarge("50 MB"));
  });
  it("takes a .pdf with no type, and refuses other files", () => {
    expect(checkFile({ name: "a.pdf", type: "", size: 1 })).toBeUndefined();
    expect(checkFile({ name: "a.doc", type: "application/msword", size: 1 })).toBe(
      MESSAGES.notAPdf,
    );
  });
});

describe("checkPassword", () => {
  it("asks for a password, and keeps spaces as typed", () => {
    expect(checkPassword("")).toBe(MESSAGES.noPassword);
    expect(checkPassword(" ")).toBeUndefined();
    expect(checkPassword("open sesame")).toBeUndefined();
  });
});

describe("verified", () => {
  const original = { locked: false as const, texts: ["Secret 1", "Secret 2"] };
  it("passes a copy that opens and reads the same text on every page", () => {
    expect(verified(original, { locked: false, texts: ["Secret 1", "Secret 2"] })).toBe(true);
  });
  it("fails a copy that still asks for a password", () => {
    expect(verified(original, { locked: true })).toBe(false);
  });
  it("fails a copy with other text or another page count", () => {
    expect(verified(original, { locked: false, texts: ["Secret 1", ""] })).toBe(false);
    expect(verified(original, { locked: false, texts: ["Secret 1"] })).toBe(false);
  });
  it("fails when the original could not be read, or has no pages", () => {
    expect(verified({ locked: true }, { locked: false, texts: [] })).toBe(false);
    expect(verified({ locked: false, texts: [] }, { locked: false, texts: [] })).toBe(false);
  });
  it("passes pages with no text when the copy has none either", () => {
    expect(verified({ locked: false, texts: [""] }, { locked: false, texts: [""] })).toBe(true);
  });
});

describe("unlockedName", () => {
  it("adds -unlocked", () => {
    expect(unlockedName("Bank Statement.PDF")).toBe("Bank Statement-unlocked.pdf");
    expect(unlockedName(".pdf")).toBe("document-unlocked.pdf");
  });
});
