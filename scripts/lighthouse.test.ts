import { describe, expect, it } from "vitest";
import {
  BUDGETS,
  CATEGORY_PAGE,
  formatResults,
  judge,
  keyPages,
  median,
  parseShard,
  type Run,
  runOf,
  shardPages,
} from "./lib/lighthouse";

const run = (overrides: Partial<Run> = {}): Run => ({
  lcp: 1500,
  cls: 0,
  tbt: 50,
  fcp: 900,
  scores: { performance: 98, accessibility: 100, "best-practices": 100, seo: 100 },
  ...overrides,
});

describe("keyPages", () => {
  it("measures home, /tools/, one category page and every tool page", () => {
    expect(keyPages(["word-counter", "compress-image"])).toEqual([
      "/",
      "/tools/",
      CATEGORY_PAGE,
      "/compress-image/",
      "/word-counter/",
    ]);
  });
});

describe("median", () => {
  it("takes the middle value, or the mean of the two middle ones", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow();
  });
});

describe("runOf", () => {
  const lhr = {
    audits: {
      "largest-contentful-paint": { numericValue: 1800 },
      "cumulative-layout-shift": { numericValue: 0.02 },
      "total-blocking-time": { numericValue: 120 },
      "first-contentful-paint": { numericValue: 1000 },
    },
    categories: {
      performance: { score: 0.97 },
      accessibility: { score: 1 },
      "best-practices": { score: 1 },
      seo: { score: 0.66 },
    },
  };

  it("reads the metrics and scores of a Lighthouse result", () => {
    expect(runOf(lhr)).toEqual({
      lcp: 1800,
      cls: 0.02,
      tbt: 120,
      fcp: 1000,
      scores: { performance: 97, accessibility: 100, "best-practices": 100, seo: 66 },
    });
  });

  it("fails on a run Lighthouse could not complete", () => {
    expect(() => runOf({ ...lhr, runtimeError: { message: "NO_FCP" } })).toThrow(/NO_FCP/);
    expect(() => runOf({ ...lhr, audits: {} })).toThrow(/largest-contentful-paint/);
  });
});

describe("judge", () => {
  it("passes a page within every budget", () => {
    expect(judge("/", [run(), run(), run()]).problems).toEqual([]);
  });

  it("judges the median, so one slow run does not fail a page", () => {
    const result = judge("/", [run(), run({ lcp: 9000, tbt: 2000 }), run()]);
    expect(result.lcp).toBe(1500);
    expect(result.problems).toEqual([]);
  });

  it("names every budget a page breaks", () => {
    const slow = run({ lcp: BUDGETS.lcp + 1, cls: 0.2, tbt: BUDGETS.tbt + 1 });
    expect(judge("/tools/", [slow]).problems).toEqual([
      "LCP 2.50 s is over 2.50 s",
      "CLS 0.200 is over 0.1",
      "TBT 201 ms is over 200 ms",
    ]);
  });

  it("formats a table the report can quote", () => {
    const text = formatResults([judge("/", [run()]), judge("/tools/", [run({ cls: 0.3 })])]);
    expect(text).toMatch(/✓ \/\s+98\s+100\s+100\s+100/);
    expect(text).toMatch(/✗ \/tools\//);
    expect(text).toContain("/tools/: CLS 0.300 is over 0.1");
  });
});

describe("shardPages", () => {
  const pages = keyPages(
    Array.from({ length: 62 }, (_, k) => `tool-${String(k).padStart(3, "0")}`),
  );
  const shards = (list: readonly string[], count: number) =>
    Array.from({ length: count }, (_, k) => shardPages(list, k + 1, count));

  it("puts every page in exactly one shard", () => {
    const all = shards(pages, 6).flat();
    expect(all).toHaveLength(pages.length);
    expect([...all].sort()).toEqual([...pages].sort());
  });

  it("keeps the shards within one page of each other", () => {
    for (const count of [1, 2, 3, 6, 7]) {
      const sizes = shards(pages, count).map((shard) => shard.length);
      expect(Math.max(...sizes) - Math.min(...sizes), `${count} shards`).toBeLessThanOrEqual(1);
    }
  });

  it("still covers every page once after a tool is added", () => {
    const more = keyPages([...pages.slice(3).map((path) => path.slice(1, -1)), "aaa-new-tool"]);
    const all = shards(more, 6).flat();
    expect([...all].sort()).toEqual([...more].sort());
    expect(new Set(all).size).toBe(more.length);
  });

  it("gives empty shards when there are more shards than pages", () => {
    const few = ["/", "/tools/"];
    const result = shards(few, 6);
    expect(result.flat().sort()).toEqual([...few].sort());
    expect(result.filter((shard) => shard.length === 0)).toHaveLength(4);
  });

  it("is the same on every call, whatever the input order", () => {
    expect(shardPages([...pages].reverse(), 2, 6)).toEqual(shardPages(pages, 2, 6));
  });

  it("refuses a shard out of range", () => {
    expect(() => shardPages(pages, 0, 6)).toThrow();
    expect(() => shardPages(pages, 7, 6)).toThrow();
  });
});

describe("parseShard", () => {
  it("reads i/n and refuses anything else", () => {
    expect(parseShard("1/6")).toEqual({ index: 1, count: 6 });
    for (const bad of ["0/6", "7/6", "1/0", "1", "a/b", "1/6/2"]) {
      expect(parseShard(bad), bad).toBeUndefined();
    }
  });
});
