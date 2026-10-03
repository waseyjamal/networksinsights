import { describe, expect, it } from "vitest";
import { CLASSIC, type Input, MAX_COUNT, random, run, UNITS, WORDS } from "./logic";

const make = (input: Partial<Input>) => {
  const result = run({ unit: "paragraphs", count: "3", classic: true, seed: 1, ...input });
  if (!result.ok) throw new Error(result.error);
  return result;
};
const words = (text: string) => text.toLowerCase().replace(/[.,]/g, "").split(" ");

describe("random", () => {
  it("gives the same numbers for the same seed", () => {
    const a = random(42);
    const b = random(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(random(1)()).not.toBe(random(2)());
  });
});

describe("run", () => {
  it("makes paragraphs, starting with the classic opening when asked", () => {
    const result = make({});
    expect(result.paragraphs).toHaveLength(3);
    expect(result.paragraphs[0]?.startsWith(CLASSIC)).toBe(true);
    expect(make({ classic: false }).paragraphs[0]?.startsWith("Lorem")).toBe(false);
  });

  it("uses only words from its own list after the opening", () => {
    const list = new Set<string>(WORDS);
    const text = make({ classic: false, count: "20" }).paragraphs.join(" ");
    expect(words(text).every((word) => list.has(word))).toBe(true);
  });

  it("makes the exact number of sentences and words", () => {
    const sentences = make({ unit: "sentences", count: "7", classic: false });
    expect(sentences.paragraphs).toHaveLength(1);
    expect(sentences.paragraphs[0]?.match(/\./g)).toHaveLength(7);
    const result = make({ unit: "words", count: "12", classic: false });
    expect(result.words).toBe(12);
    expect(words(result.paragraphs[0] ?? "")).toHaveLength(12);
    expect(make({ unit: "words", count: "5" }).paragraphs[0]).toBe("Lorem ipsum dolor sit amet.");
    expect(make({ unit: "words", count: "10" }).paragraphs[0]).toMatch(
      /^Lorem ipsum dolor sit amet consectetur adipiscing elit \w+ \w+\.$/,
    );
  });

  it("counts the words it shows", () => {
    const result = make({ count: "4" });
    expect(result.words).toBe(result.paragraphs.join(" ").split(" ").length);
  });

  it("gives the same text for the same seed and new text for another", () => {
    expect(make({ seed: 7 })).toEqual(make({ seed: 7 }));
    expect(make({ seed: 7 })).not.toEqual(make({ seed: 8 }));
  });

  it("makes exactly the maximum of each unit and refuses one more", () => {
    for (const unit of UNITS) {
      const max = MAX_COUNT[unit];
      const result = make({ unit, count: String(max), classic: false });
      if (unit === "paragraphs") expect(result.paragraphs).toHaveLength(max);
      if (unit === "sentences") expect(result.paragraphs[0]?.match(/\./g)).toHaveLength(max);
      if (unit === "words") expect(result.words).toBe(max);
      expect(run({ unit, count: String(max + 1), classic: false, seed: 1 })).toMatchObject({
        ok: false,
      });
    }
    expect(MAX_COUNT).toEqual({ paragraphs: 100, sentences: 1000, words: 10000 });
  });

  it("refuses 0, decimals and text", () => {
    for (const count of ["0", "1.5", "abc", "", "-1"]) {
      expect(run({ unit: "words", count, classic: false, seed: 1 })).toEqual({
        ok: false,
        error: "Enter a whole number of words from 1 to 10,000.",
      });
    }
  });
});
