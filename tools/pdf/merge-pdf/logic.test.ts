import { describe, expect, it } from "vitest";
import {
  checkFiles,
  formatSize,
  isPdf,
  LIMITS,
  MESSAGES,
  move,
  outputName,
  pagesLabel,
} from "./logic";

const pdf = (name: string, size = 1000, type = "application/pdf") => ({ name, type, size });

describe("checkFiles", () => {
  it("takes PDFs up to 50 MB and refuses the rest with the reason", () => {
    const { accepted, rejected } = checkFiles([
      pdf("a.pdf"),
      pdf("edge.pdf", LIMITS.maxInputBytes),
      pdf("big.pdf", LIMITS.maxInputBytes + 1),
      pdf("photo.jpg", 10, "image/jpeg"),
    ]);
    expect(accepted.map((file) => file.name)).toEqual(["a.pdf", "edge.pdf"]);
    expect(rejected).toEqual([
      { name: "big.pdf", reason: MESSAGES.tooLarge("50 MB") },
      { name: "photo.jpg", reason: MESSAGES.notAPdf },
    ]);
  });

  it("never passes 20 files, counting those already listed", () => {
    const files = Array.from({ length: 4 }, (_, i) => pdf(`${i}.pdf`));
    const { accepted, rejected } = checkFiles(files, LIMITS.maxFiles - 1);
    expect(accepted).toHaveLength(1);
    expect(rejected.map((entry) => entry.reason)).toEqual(Array(3).fill(MESSAGES.tooManyFiles(20)));
  });

  it("knows a PDF by its type, or by its name when the browser gave no type", () => {
    expect(isPdf({ name: "x.PDF", type: "" })).toBe(true);
    expect(isPdf({ name: "x.pdf", type: "text/plain" })).toBe(false);
    expect(isPdf({ name: "x", type: "" })).toBe(false);
  });
});

describe("move", () => {
  const list = ["a", "b", "c"];
  it("moves an item up or down by one", () => {
    expect(move(list, 1, -1)).toEqual(["b", "a", "c"]);
    expect(move(list, 1, 1)).toEqual(["a", "c", "b"]);
  });
  it("leaves the list as it is at either end, and never changes the original", () => {
    expect(move(list, 0, -1)).toEqual(list);
    expect(move(list, 2, 1)).toEqual(list);
    expect(move(list, 5, 1)).toEqual(list);
    expect(list).toEqual(["a", "b", "c"]);
  });
});

describe("names and labels", () => {
  it("names the result after the first PDF", () => {
    expect(outputName("Report 2026.pdf")).toBe("Report 2026-merged.pdf");
    expect(outputName(undefined)).toBe("document-merged.pdf");
    expect(outputName(".pdf")).toBe("document-merged.pdf");
  });
  it("counts pages and sizes", () => {
    expect(pagesLabel(1)).toBe("1 page");
    expect(pagesLabel(5)).toBe("5 pages");
    expect(formatSize(LIMITS.maxInputBytes)).toBe("50 MB");
  });
});
