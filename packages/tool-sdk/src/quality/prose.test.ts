import { describe, expect, it } from "vitest";
import {
  countProseWords,
  normalizeText,
  sentencesOf,
  stripFencedCode,
  toProse,
  wordsOf,
} from "./prose";

// What counts as a word of prose (ADR 0036): the words a reader reads, not the markup around them
// and not code.

describe("wordsOf", () => {
  it("counts letters and digits, and keeps inner hyphens and apostrophes", () => {
    expect(wordsOf("A well-known fox doesn't run, 2026 times.")).toEqual([
      "A",
      "well-known",
      "fox",
      "doesn't",
      "run",
      "2026",
      "times",
    ]);
  });

  it("counts words in any script", () => {
    expect(wordsOf("café naïve 東京")).toHaveLength(3);
  });
});

describe("code is not prose", () => {
  it("drops fenced code blocks, whatever the fence", () => {
    const md =
      "Before.\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n\nAfter.\n\n~~~\nmore code\n~~~\n";
    expect(toProse(md)).toBe("Before.\nAfter.");
    expect(countProseWords(md)).toBe(2);
  });

  it("closes a fence only with a fence of the same kind and at least the same length", () => {
    const md = "````md\n```\nstill code\n```\n````\nreal words here";
    expect(toProse(md)).toBe("real words here");
    expect(stripFencedCode("```\ncode\n~~~\nstill code\n```\ntext")).toBe("text");
  });

  it("drops MDX imports and exports and JSX tags, keeping the text between them", () => {
    const md =
      'import Demo from "./demo";\nexport const meta = 1;\n\n<Note tone="info">A note to read.</Note>\n';
    expect(toProse(md)).toBe("A note to read.");
  });

  it("drops HTML comments and frontmatter", () => {
    expect(toProse("---\ntitle: x\n---\nText <!-- hidden --> here.")).toBe("Text here.");
  });
});

describe("markup is not prose", () => {
  it("keeps the words of headings, list items, quotes and emphasis, without the markers", () => {
    const md =
      "### A heading\n\n- first item\n1. second item\n> quoted words\n\n**bold** and _italic_";
    expect(toProse(md).split("\n")).toEqual([
      "A heading",
      "first item",
      "second item",
      "quoted words",
      "bold and italic",
    ]);
  });

  it("keeps link text but not the address, and drops images", () => {
    expect(toProse("See [the guide](https://example.com/a/b) now. ![alt text](x.png)")).toBe(
      "See the guide now.",
    );
  });

  it("keeps the words in inline code", () => {
    expect(countProseWords("Press `Ctrl` then `C` to copy.")).toBe(6);
  });

  it("drops the separator row of a table but keeps the cells", () => {
    expect(toProse("| a | b |\n| --- | --- |\n| c | d |").split("\n")).toEqual(["a b", "c d"]);
  });
});

describe("normalizeText and sentencesOf", () => {
  it("makes two sentences that read the same compare equal", () => {
    expect(normalizeText("Paste your TEXT,  then read!")).toBe(
      normalizeText("paste your text then read"),
    );
  });

  it("splits after . ! ? and at line breaks", () => {
    expect(sentencesOf("One two. Three four! Five six?\nSeven eight")).toEqual([
      "One two.",
      "Three four!",
      "Five six?",
      "Seven eight",
    ]);
  });
});
