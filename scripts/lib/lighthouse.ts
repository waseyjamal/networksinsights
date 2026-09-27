// `pnpm check:lighthouse`: the site-wide performance budgets (ADR 0052), the pure part. The runner
// in scripts/check-lighthouse.ts measures; this file decides which pages, what passes, and how
// the result reads.
//
// Every key page is measured on Lighthouse's default mobile profile: a mid-range phone on a slow
// 4G connection, simulated. The budgets are Google's "good" thresholds for Core Web Vitals and for
// Total Blocking Time, which stands in for Interaction to Next Paint in a lab run.

export const BUDGETS = {
  /** Largest Contentful Paint, ms. */
  lcp: 2500,
  /** Cumulative Layout Shift, unitless. */
  cls: 0.1,
  /** Total Blocking Time, ms. */
  tbt: 200,
} as const;

/** The category page measured: the one of the first real tool (Mission 13). */
export const CATEGORY_PAGE = "/text-tools/";

export const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;
export type CategoryId = (typeof CATEGORIES)[number];

/** The key pages: home, /tools/, one category page and every tool page. */
export function keyPages(toolIds: readonly string[]): string[] {
  return ["/", "/tools/", CATEGORY_PAGE, ...[...toolIds].sort().map((id) => `/${id}/`)];
}

/** What one Lighthouse run of one page gave. Scores are 0 to 100. */
export interface Run {
  lcp: number;
  cls: number;
  tbt: number;
  fcp: number;
  scores: Record<CategoryId, number>;
}

/** The result of a page: the median of its runs, metric by metric. */
export interface PageResult extends Run {
  path: string;
  runs: number;
  problems: string[];
}

/** The median of a list: the middle value, or the mean of the two middle ones. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of no values");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Reads a run out of a Lighthouse result (the `lhr`). */
export function runOf(lhr: {
  audits: Record<string, { numericValue?: number } | undefined>;
  categories: Record<string, { score: number | null } | undefined>;
  runtimeError?: { message: string } | undefined;
}): Run {
  if (lhr.runtimeError) throw new Error(`Lighthouse failed: ${lhr.runtimeError.message}`);
  const metric = (id: string) => {
    const value = lhr.audits[id]?.numericValue;
    if (value === undefined) throw new Error(`Lighthouse reported no ${id}`);
    return value;
  };
  const scores = Object.fromEntries(
    CATEGORIES.map((id) => [id, Math.round((lhr.categories[id]?.score ?? 0) * 100)]),
  ) as Record<CategoryId, number>;
  return {
    lcp: metric("largest-contentful-paint"),
    cls: metric("cumulative-layout-shift"),
    tbt: metric("total-blocking-time"),
    fcp: metric("first-contentful-paint"),
    scores,
  };
}

/** The median result of a page, and every budget it breaks. */
export function judge(path: string, runs: readonly Run[]): PageResult {
  const pick = (get: (run: Run) => number) => median(runs.map(get));
  const result: PageResult = {
    path,
    runs: runs.length,
    lcp: pick((run) => run.lcp),
    cls: pick((run) => run.cls),
    tbt: pick((run) => run.tbt),
    fcp: pick((run) => run.fcp),
    scores: Object.fromEntries(
      CATEGORIES.map((id) => [id, pick((run) => run.scores[id])]),
    ) as Record<CategoryId, number>,
    problems: [],
  };
  if (result.lcp > BUDGETS.lcp) {
    result.problems.push(`LCP ${ms(result.lcp)} is over ${ms(BUDGETS.lcp)}`);
  }
  if (result.cls > BUDGETS.cls) {
    result.problems.push(`CLS ${result.cls.toFixed(3)} is over ${BUDGETS.cls}`);
  }
  if (result.tbt > BUDGETS.tbt) {
    result.problems.push(`TBT ${ms(result.tbt)} is over ${ms(BUDGETS.tbt)}`);
  }
  return result;
}

const ms = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;

export function formatResults(results: readonly PageResult[]): string {
  const width = Math.max(4, ...results.map((result) => result.path.length));
  const lines = [
    `Lighthouse, mobile profile, median of each page's runs (ADR 0052)`,
    `Budgets: LCP ≤ ${ms(BUDGETS.lcp)}, CLS ≤ ${BUDGETS.cls}, TBT ≤ ${ms(BUDGETS.tbt)}`,
    "",
    `    ${"page".padEnd(width)}  perf  a11y  best   seo     FCP      LCP     CLS      TBT`,
  ];
  for (const result of results) {
    const s = result.scores;
    lines.push(
      `  ${result.problems.length === 0 ? "✓" : "✗"} ${result.path.padEnd(width)}  ${[
        s.performance,
        s.accessibility,
        s["best-practices"],
        s.seo,
      ]
        .map((score) => String(Math.round(score)).padStart(4))
        .join("  ")}  ${ms(result.fcp).padStart(7)}  ${ms(result.lcp).padStart(7)}  ${result.cls
        .toFixed(3)
        .padStart(6)}  ${ms(result.tbt).padStart(7)}`,
    );
  }
  const failing = results.filter((result) => result.problems.length > 0);
  lines.push("");
  if (failing.length === 0) {
    lines.push("Every key page is within budget.");
  } else {
    for (const result of failing) {
      lines.push(`${result.path}: ${result.problems.join("; ")}`);
    }
  }
  return lines.join("\n");
}
