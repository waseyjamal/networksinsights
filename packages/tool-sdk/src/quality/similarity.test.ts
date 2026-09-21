import { describe, expect, it } from "vitest";
import { readContent } from "../content";
import { pageSources } from "./fixtures";
import { pageWords } from "./gates";
import { toProse, wordsOf } from "./prose";
import {
  findSimilarPairs,
  findSimilarPairsBruteForce,
  findSimilarTo,
  jaccard,
  NEAR_DUPLICATE_THRESHOLD,
  shingleSet,
} from "./similarity";
import { syntheticPages } from "./synthetic";

const words = (text: string) => text.split(/\s+/).filter(Boolean);

describe("shingleSet and jaccard", () => {
  it("scores identical texts 1 and unrelated texts 0", () => {
    const a = shingleSet(words("one two three four five six seven eight"));
    const b = shingleSet(words("alpha beta gamma delta epsilon zeta eta theta"));
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(a, b)).toBe(0);
  });

  it("ignores case and word order across shingles, but not order within one", () => {
    const a = shingleSet(words("One Two Three Four Five"));
    const b = shingleSet(words("one two three four five"));
    expect(jaccard(a, b)).toBe(1);
    expect(jaccard(a, shingleSet(words("five four three two one")))).toBe(0);
  });

  it("scores a text against a copy that changed one word in the middle", () => {
    const original = words("a b c d e f g h i j k l");
    const changed = [...original];
    changed[6] = "X";
    // Nine 4-word shingles; changing one word breaks the four that contain it.
    expect(jaccard(shingleSet(original), shingleSet(changed))).toBeCloseTo(5 / 13, 5);
  });

  it("gives a text shorter than a shingle a single shingle of itself", () => {
    expect(shingleSet(words("two words"))).toHaveLength(1);
    expect(jaccard(shingleSet(words("two words")), shingleSet(words("two words")))).toBe(1);
    expect(shingleSet([])).toHaveLength(0);
    expect(jaccard(shingleSet([]), shingleSet([]))).toBe(0);
  });
});

describe("the fast path finds what brute force finds", () => {
  const { pages } = syntheticPages(300, 12);
  const sets = pages.map((page) => shingleSet(page));

  it("returns the same pairs with the same scores, at the threshold and above", () => {
    const exact = findSimilarPairsBruteForce(sets, NEAR_DUPLICATE_THRESHOLD);
    const fast = findSimilarPairs(sets, NEAR_DUPLICATE_THRESHOLD);
    expect(exact.length).toBeGreaterThanOrEqual(12);
    expect(fast).toEqual(exact);
  });

  it("finds every planted copy, from a light edit to a heavy one", () => {
    const { planted } = syntheticPages(300, 12);
    const found = new Set(
      findSimilarPairs(sets, NEAR_DUPLICATE_THRESHOLD).map((pair) => `${pair.a}:${pair.b}`),
    );
    for (const copy of planted) {
      expect(found.has(`${copy.original}:${copy.copy}`), JSON.stringify(copy)).toBe(true);
    }
  });

  it("finds the same pairs at the stricter summary threshold too", () => {
    expect(findSimilarPairs(sets, 0.6)).toEqual(findSimilarPairsBruteForce(sets, 0.6));
  });

  it("is deterministic", () => {
    expect(findSimilarPairs(sets)).toEqual(findSimilarPairs(sets));
  });

  it("compares one page against all the others exactly", () => {
    const target = sets.length - 1;
    const one = findSimilarTo(sets, target, NEAR_DUPLICATE_THRESHOLD);
    const all = findSimilarPairsBruteForce(sets, NEAR_DUPLICATE_THRESHOLD).filter(
      (pair) => pair.a === target || pair.b === target,
    );
    expect(one).toEqual(all);
  });
});

describe("speed", () => {
  it("compares 1,000 synthetic tools with planted copies in about a second", () => {
    const { pages, planted } = syntheticPages(1000, 20);
    const start = performance.now();
    const sets = pages.map((page) => shingleSet(page));
    const shingled = performance.now();
    const pairs = findSimilarPairs(sets, NEAR_DUPLICATE_THRESHOLD);
    const done = performance.now();
    const exact = findSimilarPairsBruteForce(sets, NEAR_DUPLICATE_THRESHOLD);
    const brute = performance.now();
    console.log(
      `1,000 tools: shingling ${(shingled - start).toFixed(0)} ms, sketches + candidates + exact scores ${(done - shingled).toFixed(0)} ms (total ${(done - start).toFixed(0)} ms), ${pairs.length} pairs found; all 499,500 pairs compared exactly: ${(brute - done).toFixed(0)} ms`,
    );
    expect(pairs.length).toBeGreaterThanOrEqual(planted.length);
    expect(pairs).toEqual(exact);
    // A loose ceiling: the number that matters is the one printed above.
    expect(done - start).toBeLessThan(15_000);
    // The brute-force pass takes several seconds, so this test gets more than the default five.
  }, 60_000);
});

describe("calibration: how far apart are 'similar topic' and 'copied template'?", () => {
  const page = (name: string) => shingleSet(pageWords(pageSources[name] ?? ""));
  const swap = (text: string) =>
    text
      .replaceAll("JPG", "@1")
      .replaceAll("PNG", "JPG")
      .replaceAll("@1", "PNG")
      .replaceAll("jpg", "@2")
      .replaceAll("png", "jpg")
      .replaceAll("@2", "png");

  it("scores every independently written pair of related tools far below the threshold", () => {
    const pairs: Array<[string, string]> = [
      ["jpg-to-png", "png-to-jpg"],
      ["word-counter", "character-counter"],
      ["base64-encode", "base64-decode"],
      ["merge-pdf", "split-pdf"],
    ];
    for (const [a, b] of pairs) {
      const score = jaccard(page(a), page(b));
      console.log(`related, written separately: ${a} vs ${b} = ${score.toFixed(3)}`);
      expect(score).toBeLessThan(NEAR_DUPLICATE_THRESHOLD / 10);
    }
  });

  it("puts the threshold in the gap between 'some sections copied' and 'most sections copied'", () => {
    const parts = (name: string) => {
      const content = readContent(pageSources[name] ?? "");
      return [content.intro, ...content.parts.map((part) => part.body)];
    };
    const set = (texts: string[]) => shingleSet(wordsOf(toProse(texts.join("\n"))));
    const own = parts("jpg-to-png");
    const other = parts("png-to-jpg");
    const scores = [4, 3, 2, 1].map((kept) => ({
      kept,
      score: jaccard(set(own), set([...own.slice(0, kept), ...other.slice(kept)])),
    }));
    for (const { kept, score } of scores) {
      console.log(`${kept} of 5 parts kept, the rest from the other page: ${score.toFixed(3)}`);
    }
    const byKept = Object.fromEntries(scores.map(({ kept, score }) => [kept, score]));
    // A page that keeps three of its five parts is a near-duplicate; one that keeps two is not.
    expect(byKept[3]).toBeGreaterThanOrEqual(NEAR_DUPLICATE_THRESHOLD);
    expect(byKept[2]).toBeLessThan(NEAR_DUPLICATE_THRESHOLD);
  });

  it("scores the same page with the tool names swapped far above it", () => {
    const original = pageSources["jpg-to-png"] ?? "";
    const score = jaccard(shingleSet(pageWords(original)), shingleSet(pageWords(swap(original))));
    console.log(`copied template, names swapped: jpg-to-png vs its swap = ${score.toFixed(3)}`);
    expect(score).toBeGreaterThan(NEAR_DUPLICATE_THRESHOLD * 2);
  });
});
