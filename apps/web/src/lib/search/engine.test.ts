import { describe, expect, it } from "vitest";
import { corpus } from "./corpus";
import { createEngine, fold, segments, tokenize } from "./engine";
import type { SearchRecord } from "./types";

// U+0301, a combining acute accent. Built here so the tests show it instead of hiding it in a letter.
const ACUTE = String.fromCharCode(0x301);

const engine = createEngine(corpus);
const ids = (query: string, limit = 20) =>
  engine.search(query, { limit }).hits.map((hit) => hit.record.id);

describe("folding and tokens", () => {
  it("keeps every offset: the folded text is as long as the original", () => {
    for (const text of [
      "Café",
      "İstanbul",
      "ÀÉÎÕÜ",
      `a${ACUTE}b`,
      "😀 emoji",
      "ǅ",
      "ẞ",
      "Straße",
    ]) {
      expect(fold(text).length, text).toBe(text.length);
    }
  });

  it("lowercases and drops accents", () => {
    expect(fold("Café ÀÉÎ")).toBe("cafe aei");
  });

  it("splits on anything that is not a letter or a digit, and reports where", () => {
    expect(tokenize("PDF-to-Word 2.0!")).toEqual([
      { term: "pdf", start: 0, end: 3 },
      { term: "to", start: 4, end: 6 },
      { term: "word", start: 7, end: 11 },
      { term: "2", start: 12, end: 13 },
      { term: "0", start: 14, end: 15 },
    ]);
  });

  it("finds a word that has a combining accent in the middle", () => {
    expect(tokenize(`re${ACUTE}sume`).map((token) => token.term)).toEqual(["resume"]);
  });

  it("treats an emoji as a separator", () => {
    expect(tokenize("a😀b").map((token) => token.term)).toEqual(["a", "b"]);
  });
});

describe("matching", () => {
  it("returns nothing for an empty or symbol-only query", () => {
    expect(engine.search("").total).toBe(0);
    expect(engine.search("   ").total).toBe(0);
    expect(engine.search("!?#").total).toBe(0);
  });

  it("returns nothing when the index is empty", () => {
    expect(createEngine([]).search("pdf").total).toBe(0);
  });

  it("matches a prefix, from the first letter of the word being typed", () => {
    expect(ids("comp")).toEqual(expect.arrayContaining(["compress-pdf", "compress-image"]));
    expect(ids("w")).toContain("word-counter");
  });

  it("requires every word of the query", () => {
    expect(ids("compress pdf")).toContain("compress-pdf");
    expect(ids("compress pdf")).not.toContain("compress-video");
    expect(ids("pdf banana")).toEqual([]);
  });

  it("does not guess at short words", () => {
    expect(ids("pdx")).toEqual([]);
    expect(ids("mrge")).toContain("merge-pdf");
  });

  it("tolerates a typo, a missing letter and a swap", () => {
    expect(ids("mergee pdf")).toContain("merge-pdf");
    expect(ids("mrge pdf")).toContain("merge-pdf");
    expect(ids("compres pdf")).toContain("compress-pdf");
    expect(ids("imgae")).toContain("compress-image");
    expect(ids("compess")).toContain("compress-pdf");
  });

  it("tolerates a typo in an unfinished word", () => {
    expect(ids("convrt")).toContain("jpg-to-png");
  });

  it("ignores accents in both directions", () => {
    expect(ids("cafe")).toEqual(["café-menu"]);
    expect(ids("café")).toEqual(["café-menu"]);
  });

  it("drops stop words, unless the query is nothing else", () => {
    expect(ids("merge the pdf")).toContain("merge-pdf");
    expect(engine.search("to").total).toBeGreaterThan(0);
  });

  it("treats jpg and jpeg as one name", () => {
    expect(ids("jpeg")).toContain("jpg-to-png");
    expect(ids("jpg")).toContain("image-format-switcher");
  });

  it("caps a very long query instead of doing unbounded work", () => {
    expect(() => engine.search("compress ".repeat(500))).not.toThrow();
  });

  it("returns the total, and no more hits than the limit", () => {
    const result = engine.search("compress", { limit: 2 });
    expect(result.hits).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(engine.search("compress", { limit: 0 }).hits).toEqual([]);
  });

  it("skips the highlight work when asked", () => {
    const [hit] = engine.search("compress", { highlight: false }).hits;
    expect(hit?.name).toEqual([]);
    expect(hit?.summary).toEqual([]);
  });

  it("gives the same answer every time", () => {
    const first = ids("convert");
    expect(ids("convert")).toEqual(first);
    expect(
      createEngine([...corpus].reverse())
        .search("convert", { limit: 20 })
        .hits.map((h) => h.record.id),
    ).toEqual(first);
  });
});

describe("ranking", () => {
  it("puts an exact name first", () => {
    expect(ids("word counter")[0]).toBe("word-counter");
    expect(ids("Compress PDF")[0]).toBe("compress-pdf");
    expect(ids("base64 encoder")[0]).toBe("base64-encoder");
    expect(ids("pdf to word")[0]).toBe("pdf-to-word");
  });

  it("puts a name that starts with the query above one that only mentions it", () => {
    expect(ids("compress")[0]).toMatch(/^compress-/);
    expect(ids("merge")[0]).toBe("merge-pdf");
  });

  it("finds a tool through a typo and still ranks it first", () => {
    expect(ids("comprss pdf")[0]).toBe("compress-pdf");
    expect(ids("wrod countr")[0]).toBe("word-counter");
  });

  it("ranks a name match above a tag match above a summary match", () => {
    const records: SearchRecord[] = [
      {
        id: "s",
        name: "Alpha",
        category: "text",
        summary: "Works on zebra data.",
        tags: ["a"],
        href: "/s/",
      },
      {
        id: "t",
        name: "Beta",
        category: "text",
        summary: "Does a small job.",
        tags: ["zebra"],
        href: "/t/",
      },
      {
        id: "n",
        name: "Zebra",
        category: "text",
        summary: "Does another job.",
        tags: ["c"],
        href: "/n/",
      },
    ];
    const order = createEngine(records)
      .search("zebra")
      .hits.map((hit) => hit.record.id);
    expect(order).toEqual(["n", "t", "s"]);
  });

  it("ranks a format match above a summary match", () => {
    const records: SearchRecord[] = [
      {
        id: "s",
        name: "Alpha",
        category: "text",
        summary: "Handles webp data well.",
        tags: ["a"],
        href: "/s/",
      },
      {
        id: "f",
        name: "Beta",
        category: "text",
        summary: "Does a small job.",
        tags: ["b"],
        accepts: ["WEBP"],
        href: "/f/",
      },
    ];
    expect(
      createEngine(records)
        .search("webp")
        .hits.map((hit) => hit.record.id),
    ).toEqual(["f", "s"]);
  });

  it("finds the tools whose formats match a 'jpg to png' query", () => {
    const found = ids("jpg to png");
    expect(found).toEqual(
      expect.arrayContaining([
        "jpg-to-png",
        "png-to-jpg",
        "image-format-switcher",
        "picture-format-switcher",
      ]),
    );
    expect(found).not.toContain("compress-video");
    expect(found).not.toContain("word-counter");
  });

  it("puts the tool that goes from JPG to PNG above the one that goes the other way", () => {
    const found = ids("jpg to png");
    expect(found.indexOf("jpg-to-png")).toBeLessThan(found.indexOf("png-to-jpg"));
    expect(found.indexOf("image-format-switcher")).toBeLessThan(
      found.indexOf("picture-format-switcher"),
    );
  });

  it("reads an arrow as 'to', and jpeg as jpg", () => {
    const viaArrow = ids("jpeg -> png");
    expect(viaArrow.indexOf("image-format-switcher")).toBeLessThan(
      viaArrow.indexOf("picture-format-switcher"),
    );
    expect(ids("jpg → png")[0]).toBe("jpg-to-png");
  });

  it("finds format queries with one word", () => {
    expect(ids("mp3")).toEqual(["video-and-audio-converter"]);
    expect(ids("docx")).toEqual(["pdf-to-word"]);
  });
});

describe("highlighting", () => {
  const one = (query: string, id: string) => {
    const hit = engine.search(query, { limit: 20 }).hits.find((h) => h.record.id === id);
    if (!hit) throw new Error(`no hit for ${id}`);
    return hit;
  };
  const marked = (text: string, ranges: Parameters<typeof segments>[1]) =>
    segments(text, ranges)
      .filter((piece) => piece.match)
      .map((piece) => piece.text);

  it("marks only what was typed when the match is a prefix", () => {
    const hit = one("comp", "compress-pdf");
    expect(marked(hit.record.name, hit.name)).toEqual(["Comp"]);
  });

  it("marks the whole word for an exact match and for a typo", () => {
    expect(marked("Compress PDF", one("pdf", "compress-pdf").name)).toEqual(["PDF"]);
    expect(marked("Compress PDF", one("comprss", "compress-pdf").name)).toEqual(["Compress"]);
  });

  it("marks in the summary too", () => {
    const hit = one("smaller", "compress-pdf");
    expect(marked(hit.record.summary, hit.summary)).toEqual(["smaller"]);
  });

  it("marks the original text, accents included", () => {
    const hit = one("cafe", "café-menu");
    expect(marked(hit.record.name, hit.name)).toEqual(["Café"]);
  });

  it("hints at the formats when only a format matched", () => {
    const hit = one("webp", "compress-image");
    expect(hit.name).toEqual([]);
    expect(hit.summary).toEqual([]);
    expect(hit.hint).toEqual({ accepts: ["WEBP"], produces: ["WEBP"] });
  });

  it("gives no hint when the name or the summary already shows the match", () => {
    expect(one("compress", "compress-image").hint).toBeUndefined();
  });
});
