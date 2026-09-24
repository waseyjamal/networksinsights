import { describe, expect, it } from "vitest";
import { createEngine, segments } from "./engine";
import type { SearchRecord } from "./types";

// U+0301, a combining acute accent, written so the tests show it.
const ACUTE = String.fromCharCode(0x301);

// Highlighting is how a tool's own words get onto the page next to what the visitor typed, so it
// must never turn either of them into markup. The engine returns offsets and `segments` returns
// plain strings: the UI makes text nodes and <mark> elements from them and never parses HTML.

describe("segments", () => {
  it("returns the whole text when nothing matched", () => {
    expect(segments("Compress PDF", [])).toEqual([{ text: "Compress PDF", match: false }]);
    expect(segments("", [])).toEqual([]);
  });

  it("cuts a text at the ends of its ranges, and joins back to the original", () => {
    const text = "Compress PDF files";
    const parts = segments(text, [
      { start: 0, end: 8 },
      { start: 9, end: 12 },
    ]);
    expect(parts).toEqual([
      { text: "Compress", match: true },
      { text: " ", match: false },
      { text: "PDF", match: true },
      { text: " files", match: false },
    ]);
    expect(parts.map((part) => part.text).join("")).toBe(text);
  });

  it("clamps a range that reaches past the text and skips one that is empty", () => {
    expect(segments("abc", [{ start: 1, end: 99 }])).toEqual([
      { text: "a", match: false },
      { text: "bc", match: true },
    ]);
    expect(segments("abc", [{ start: 2, end: 2 }])).toEqual([{ text: "abc", match: false }]);
    expect(segments("abc", [{ start: 50, end: 60 }])).toEqual([{ text: "abc", match: false }]);
  });

  it("does not repeat text when ranges overlap", () => {
    const parts = segments("abcdef", [
      { start: 0, end: 4 },
      { start: 2, end: 6 },
    ]);
    expect(parts.map((part) => part.text).join("")).toBe("abcdef");
  });
});

describe("hostile text", () => {
  const record = (overrides: Partial<SearchRecord>): SearchRecord => ({
    id: "x",
    name: "Plain name",
    category: "text",
    summary: "A plain summary of the tool.",
    tags: ["plain"],
    href: "/x/",
    ...overrides,
  });

  it("returns markup in a name as text, and marks only the matched word", () => {
    const name = '<img src=x onerror="alert(1)"> Script Tool';
    const engine = createEngine([record({ name })]);
    const [hit] = engine.search("script").hits;
    const parts = segments(name, hit?.name ?? []);
    expect(parts.map((part) => part.text).join("")).toBe(name);
    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual(["Script"]);
  });

  it("searches for markup typed by the visitor without failing", () => {
    const engine = createEngine([record({ name: "Script Tool" })]);
    for (const query of [
      "<script>alert(1)</script>",
      '"><img src=x>',
      "&amp;",
      "\\",
      "%00",
      "(?:",
    ]) {
      expect(() => engine.search(query), query).not.toThrow();
    }
    // The words inside the markup are still words: the visitor typed "script" and "alert".
    expect(engine.search("<script>").total).toBe(1);
  });

  it("keeps offsets right for text with accents, combining marks and emoji", () => {
    const name = `Ça va 😀 Café e${ACUTE}tude`;
    const engine = createEngine([record({ name })]);
    const marked = (query: string) => {
      const hit = engine.search(query).hits[0];
      return segments(name, hit?.name ?? [])
        .filter((part) => part.match)
        .map((part) => part.text);
    };
    expect(marked("cafe")).toEqual(["Café"]);
    expect(marked("va")).toEqual(["va"]);
    // A prefix of a word with a combining accent marks the accent with its letter.
    expect(marked("etud")).toEqual([`e${ACUTE}tud`]);
    expect(marked("etude")).toEqual([`e${ACUTE}tude`]);
  });

  it("never returns a range outside its text", () => {
    const names = ["İstanbul Ünïcode", "ǅ ǆ ẞ", `a${ACUTE}${ACUTE}b`, "😀😀", "", " "];
    for (const name of names) {
      const engine = createEngine([record({ name, summary: `About ${name} and more text.` })]);
      for (const query of ["i", "u", "b", "a", "istanbul", "ss", "text"]) {
        for (const hit of engine.search(query).hits) {
          for (const range of [...hit.name, ...hit.summary]) {
            expect(range.start).toBeGreaterThanOrEqual(0);
            expect(range.end).toBeGreaterThan(range.start);
          }
          for (const range of hit.name) expect(range.end).toBeLessThanOrEqual(name.length);
        }
      }
    }
  });
});
