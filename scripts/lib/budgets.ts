// `pnpm check:budgets`: the JavaScript budget of every tool page, measured on the real build
// output in apps/web/dist (ADR 0037).
//
// A tool page mounts one Astro island. This reads the built HTML, finds the island's own script
// and the shared renderer script, follows the import graph of the built chunks, and measures two
// things separately, in KB of gzip:
//
//   initial    the tool's own code loaded on page load: the island's static imports, without the
//              shared renderer (React, ReactDOM, Astro's client runtime).
//   on demand  code fetched only after the visitor does something: chunks reached only through a
//              dynamic import(), and .wasm files or worker scripts loaded by URL. Lazy loading
//              is rewarded, because this number has a much higher ceiling.

import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import {
  type ContractViolation,
  DEFAULT_INITIAL_JS_KB,
  DEFAULT_ON_DEMAND_JS_KB,
  formatViolation,
  INITIAL_JS_CEILING_KB,
  indentMessage,
  ON_DEMAND_JS_CEILING_KB,
  type ResolvedBudget,
  resolveBudget,
  type ToolBudget,
} from "@networksinsights/tool-sdk";

const KB = 1024;

/** One built file and what it weighs. */
export interface FileWeight {
  /** Path inside dist, with forward slashes: `_astro/ui.AbC123.js`. */
  path: string;
  raw: number;
  gzip: number;
  brotli: number;
}

/** A set of files and their total. */
export interface Weight {
  files: FileWeight[];
  raw: number;
  gzip: number;
  brotli: number;
}

/** What one tool page loads, split the way the budget is. */
export interface PageJs {
  /** The shared renderer: React, ReactDOM and Astro's client runtime. Not charged to the tool. */
  shared: Weight;
  initial: Weight;
  onDemand: Weight;
}

const sum = (files: FileWeight[]): Weight => ({
  files,
  raw: files.reduce((total, file) => total + file.raw, 0),
  gzip: files.reduce((total, file) => total + file.gzip, 0),
  brotli: files.reduce((total, file) => total + file.brotli, 0),
});

const readDist = (distDir: string, path: string) => readFileSync(join(distDir, path));

function weigh(distDir: string, path: string): FileWeight {
  const bytes = readDist(distDir, path);
  return {
    path,
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes).length,
  };
}

/** `/_astro/x.js` and `./x.js` (from `_astro/a.js`) to a path inside dist: `_astro/x.js`. */
function resolveUrl(url: string, from: string): string | undefined {
  if (/^(?:[a-z]+:)?\/\//i.test(url) || url.startsWith("data:")) return undefined;
  const clean = url.split(/[?#]/)[0] ?? url;
  if (clean.startsWith("/")) return clean.slice(1);
  return posix.normalize(posix.join(posix.dirname(from), clean));
}

interface Edges {
  /** Chunks imported statically: they load with the chunk that imports them. */
  static: string[];
  /** Chunks imported with import(): they load when that code runs. */
  dynamic: string[];
  /** Files fetched by URL from code: .wasm files and worker scripts. Loaded on demand. */
  assets: string[];
}

// Built code quotes its strings with ", ' or a backtick, whichever the bundler chose.
const IMPORT_STATIC = /(?:\bfrom|\bimport)\s*["'`]([^"'`]+\.m?js)["'`]/g;
const IMPORT_DYNAMIC = /\bimport\(\s*["'`]([^"'`]+\.m?js)["'`]\s*\)/g;
const URL_ASSET = /new URL\(\s*["'`]([^"'`]+\.(?:wasm|m?js))["'`]\s*,\s*import\.meta\.url\s*\)/g;
const BARE_ASSET = /["'`](\/[^"'`\s]+\.wasm)["'`]/g;

function edgesOf(distDir: string, file: string): Edges {
  const text = readDist(distDir, file).toString("utf8");
  const collect = (pattern: RegExp) =>
    [...text.matchAll(pattern)]
      .map((match) => resolveUrl(match[1] ?? "", file))
      .filter((path): path is string => path !== undefined && existsSync(join(distDir, path)));
  return {
    static: collect(IMPORT_STATIC),
    dynamic: collect(IMPORT_DYNAMIC),
    assets: [...collect(URL_ASSET), ...collect(BARE_ASSET)],
  };
}

/** Everything reachable from a chunk. `dynamic` and `assets` choose which edges are followed. */
function reach(
  distDir: string,
  entry: string,
  follow: { dynamic: boolean; assets: boolean },
): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    // A .wasm file has no imports to read.
    if (!/\.m?js$/.test(file)) return;
    const edges = edgesOf(distDir, file);
    for (const next of edges.static) visit(next);
    if (follow.dynamic) for (const next of edges.dynamic) visit(next);
    if (follow.assets) for (const next of edges.assets) visit(next);
  };
  visit(entry);
  return seen;
}

/** The `<astro-island>` of a page: its own script and the shared renderer's. */
export function findIslands(html: string): Array<{ component: string; renderer: string }> {
  return [...html.matchAll(/<astro-island\b[^>]*>/g)].flatMap((match) => {
    const tag = match[0];
    const component = /\bcomponent-url="([^"]+)"/.exec(tag)?.[1];
    const renderer = /\brenderer-url="([^"]+)"/.exec(tag)?.[1];
    return component && renderer ? [{ component, renderer }] : [];
  });
}

/**
 * What the island of a built page loads, split into the shared renderer, the tool's initial code
 * and the tool's on-demand code. Undefined when the page has no island.
 */
export function measurePageJs(distDir: string, htmlPath: string): PageJs | undefined {
  const html = readDist(distDir, htmlPath).toString("utf8");
  const islands = findIslands(html);
  if (islands.length === 0) return undefined;

  const shared = new Set<string>();
  const initial = new Set<string>();
  const everything = new Set<string>();
  for (const island of islands) {
    const renderer = resolveUrl(island.renderer, htmlPath);
    const component = resolveUrl(island.component, htmlPath);
    if (!renderer || !component) continue;
    for (const file of reach(distDir, renderer, { dynamic: false, assets: false }))
      shared.add(file);
    for (const file of reach(distDir, component, { dynamic: false, assets: false })) {
      initial.add(file);
    }
    for (const file of reach(distDir, component, { dynamic: true, assets: true })) {
      everything.add(file);
    }
  }

  // A file that only the renderer needs is not the tool's. Assets (.wasm, worker scripts) are
  // fetched by explicit calls, so they always count as on demand.
  const isCode = (file: string) => /\.m?js$/.test(file);
  const initialOwn = [...initial].filter((file) => !shared.has(file) && isCode(file)).sort();
  const onDemandOwn = [...everything]
    .filter((file) => !shared.has(file) && (!initial.has(file) || !isCode(file)))
    .sort();

  return {
    shared: sum([...shared].sort().map((file) => weigh(distDir, file))),
    initial: sum(initialOwn.map((file) => weigh(distDir, file))),
    onDemand: sum(onDemandOwn.map((file) => weigh(distDir, file))),
  };
}

/** One tool the budgets are checked for. */
export interface BudgetTarget {
  id: string;
  /** The tool folder, for messages: `tools/text/word-counter`. */
  dir: string;
  budget?: ToolBudget | undefined;
}

export interface ToolBudgetResult {
  id: string;
  dir: string;
  /** The page measured, or undefined when there is none to measure. */
  js: PageJs | undefined;
  budget: ResolvedBudget;
  /** True when the manifest raised either budget. */
  raised: boolean;
  violations: ContractViolation[];
}

export const kb = (bytes: number) => bytes / KB;
const fmt = (bytes: number) => `${kb(bytes).toFixed(1)} KB`;

const biggest = (weight: Weight, count = 3) =>
  [...weight.files]
    .sort((a, b) => b.gzip - a.gzip)
    .slice(0, count)
    .map((file) => `${file.path} (${fmt(file.gzip)})`)
    .join(", ");

function measureTarget(distDir: string, target: BudgetTarget): ToolBudgetResult {
  const budget = resolveBudget(target.budget);
  const raised = target.budget !== undefined;
  const base = { id: target.id, dir: target.dir, budget, raised };
  const htmlPath = `${target.id}/index.html`;

  if (!existsSync(join(distDir, htmlPath))) {
    return {
      ...base,
      js: undefined,
      violations: [
        {
          dir: target.dir,
          gate: "budget",
          problem: `has no built page at ${htmlPath} in the build output`,
          fix: "run `pnpm build` first; if you did, the page did not build, and the build output says why",
        },
      ],
    };
  }

  const js = measurePageJs(distDir, htmlPath);
  if (!js) {
    return {
      ...base,
      js,
      violations: [
        {
          dir: target.dir,
          gate: "budget",
          file: "island.astro",
          problem: `the built page /${target.id}/ has no island, so its ui.tsx is not on the page`,
          fix:
            "island.astro must be the contract source, and the page template must mount it; run `pnpm check:tools --tool " +
            target.id +
            "`",
        },
      ],
    };
  }

  const violations: ContractViolation[] = [];
  const raiseHint = (field: string, current: number, ceiling: number, size: number) =>
    current >= ceiling
      ? `the ceiling is ${ceiling} KB and cannot be raised without an ADR (ADR 0037), so the code has to get smaller`
      : `if the tool is genuinely this heavy, raise it in tool.config.ts, with a reason the page never shows: budget: { ${field}: ${Math.min(ceiling, Math.ceil(kb(size) / 10) * 10 + 10)}, reason: "Why this tool needs more" }`;

  if (kb(js.initial.gzip) > budget.initialKb) {
    violations.push({
      dir: target.dir,
      gate: "budget",
      file: "ui.tsx",
      problem: `initial island JavaScript is ${fmt(js.initial.gzip)} gzip; the budget is ${budget.initialKb} KB (the shared React and Astro runtime is not counted)`,
      fix: `load heavy code only when the visitor needs it, with a dynamic import() inside the handler, for example \`const engine = await import("./engine");\` in the click handler; that code then counts as on-demand (budget ${budget.onDemandKb} KB). Biggest files: ${biggest(js.initial)}. Otherwise, ${raiseHint("maxInitialJsKb", budget.initialKb, INITIAL_JS_CEILING_KB, js.initial.gzip)}`,
    });
  }
  if (kb(js.onDemand.gzip) > budget.onDemandKb) {
    violations.push({
      dir: target.dir,
      gate: "budget",
      file: "ui.tsx",
      problem: `on-demand JavaScript (dynamic imports, .wasm files, workers) is ${fmt(js.onDemand.gzip)} gzip; the budget is ${budget.onDemandKb} KB`,
      fix: `trim what is fetched after a user action. Biggest files: ${biggest(js.onDemand)}. Otherwise, ${raiseHint("maxOnDemandJsKb", budget.onDemandKb, ON_DEMAND_JS_CEILING_KB, js.onDemand.gzip)}`,
    });
  }
  return { ...base, js, violations };
}

export interface BudgetReport {
  distDir: string;
  results: ToolBudgetResult[];
  problemCount: number;
  ok: boolean;
}

/** Measures every target against its budget. With no targets it passes and says so. */
export function checkBudgets(distDir: string, targets: readonly BudgetTarget[]): BudgetReport {
  const results = targets.map((target) => measureTarget(distDir, target));
  const problemCount = results.reduce((total, result) => total + result.violations.length, 0);
  return { distDir, results, problemCount, ok: problemCount === 0 };
}

/** The table the owner reads, then every problem with its fix. */
export function formatBudgetReport(report: BudgetReport): string {
  const out = [
    `JavaScript budgets, gzip, the tool's own code (shared React and Astro runtime not counted)`,
    `  defaults: ${DEFAULT_INITIAL_JS_KB} KB initial, ${DEFAULT_ON_DEMAND_JS_KB} KB on demand (ADR 0037)`,
    "",
  ];
  if (report.results.length === 0) {
    out.push("  There are no tool pages in the build, so there is nothing to measure.");
  }
  const width = Math.max(0, ...report.results.map((result) => result.id.length));
  for (const result of report.results) {
    const mark = result.violations.length === 0 ? "✓" : "✗";
    const initial = result.js ? kb(result.js.initial.gzip).toFixed(1) : "-";
    const demand = result.js ? kb(result.js.onDemand.gzip).toFixed(1) : "-";
    out.push(
      `  ${mark} ${result.id.padEnd(width)}  initial ${initial} / ${result.budget.initialKb} KB   on demand ${demand} / ${result.budget.onDemandKb} KB${result.raised ? "   (raised in tool.config.ts)" : ""}`,
    );
  }
  if (report.problemCount > 0) {
    out.push(
      "",
      `${report.problemCount} ${report.problemCount === 1 ? "problem" : "problems"} to fix:`,
      "",
    );
    for (const result of report.results) {
      for (const violation of result.violations) {
        out.push(
          indentMessage(
            formatViolation(violation).replace('Quality gate "budget":', "JavaScript budget:"),
          ),
        );
      }
    }
  } else if (report.results.length > 0) {
    out.push("", "All tool pages are within budget.");
  }
  return out.join("\n");
}

/** The report as JSON, for an agent or a script. */
export function budgetReportToJson(report: BudgetReport): string {
  return JSON.stringify(
    {
      ok: report.ok,
      tools: report.results.map((result) => ({
        id: result.id,
        ok: result.violations.length === 0,
        budgetKb: { initial: result.budget.initialKb, onDemand: result.budget.onDemandKb },
        raised: result.raised,
        initialKb: result.js ? round(kb(result.js.initial.gzip)) : null,
        onDemandKb: result.js ? round(kb(result.js.onDemand.gzip)) : null,
        problems: result.violations.map((v) => ({ problem: v.problem, fix: v.fix })),
      })),
    },
    null,
    2,
  );
}

const round = (value: number) => Math.round(value * 10) / 10;

// ---------------------------------------------------------------------------------------------
// Page weight

export interface PageWeight {
  html: FileWeight;
  css: Weight;
  fonts: Weight;
  js: PageJs;
  /** Inline <script> and <style> text, which is part of the HTML file already. */
  inlineScriptBytes: number;
  total: { raw: number; gzip: number; brotli: number };
}

/** The `href`s and `src`s a page names, by tag. */
function attributeValues(html: string, tag: RegExp, attribute: string): string[] {
  return [...html.matchAll(tag)]
    .map((match) => new RegExp(`\\b${attribute}="([^"]+)"`).exec(match[0])?.[1])
    .filter((value): value is string => value !== undefined);
}

/**
 * What a visitor downloads for a tool page: the HTML, the stylesheets, the fonts the page loads,
 * the shared renderer and the tool's own code (initial and on demand). Each file counts once.
 */
export function measurePageWeight(distDir: string, id: string): PageWeight | undefined {
  const htmlPath = `${id}/index.html`;
  if (!existsSync(join(distDir, htmlPath))) return undefined;
  const js = measurePageJs(distDir, htmlPath);
  if (!js) return undefined;
  const html = readDist(distDir, htmlPath).toString("utf8");

  const exists = (path: string | undefined): path is string =>
    path !== undefined && existsSync(join(distDir, path));
  const stylesheets = attributeValues(html, /<link\b[^>]*rel="stylesheet"[^>]*>/g, "href")
    .map((href) => resolveUrl(href, htmlPath))
    .filter(exists);

  // Fonts: the ones the page preloads, and the ones its CSS names.
  const fontPaths = new Set<string>();
  const preload = attributeValues(html, /<link\b[^>]*as="font"[^>]*>/g, "href");
  for (const href of preload) {
    const path = resolveUrl(href, htmlPath);
    if (exists(path)) fontPaths.add(path);
  }
  const cssTexts = [
    ...stylesheets.map((path) => readDist(distDir, path).toString("utf8")),
    ...[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1] ?? ""),
  ];
  for (const css of cssTexts) {
    for (const match of css.matchAll(/url\(\s*["']?([^"')]+\.woff2?)["']?\s*\)/g)) {
      const path = resolveUrl(match[1] ?? "", htmlPath);
      if (exists(path)) fontPaths.add(path);
    }
  }

  const inlineScriptBytes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].reduce(
    (total, match) => total + Buffer.byteLength(match[1] ?? ""),
    0,
  );

  const htmlWeight = weigh(distDir, htmlPath);
  const css = sum([...new Set(stylesheets)].map((path) => weigh(distDir, path)));
  const fonts = sum([...fontPaths].map((path) => weigh(distDir, path)));
  const parts = [
    htmlWeight,
    ...css.files,
    ...fonts.files,
    ...js.shared.files,
    ...js.initial.files,
    ...js.onDemand.files,
  ];
  return {
    html: htmlWeight,
    css,
    fonts,
    js,
    inlineScriptBytes,
    total: {
      raw: parts.reduce((total, part) => total + part.raw, 0),
      gzip: parts.reduce((total, part) => total + part.gzip, 0),
      brotli: parts.reduce((total, part) => total + part.brotli, 0),
    },
  };
}

export function formatPageWeight(id: string, weight: PageWeight): string {
  const row = (label: string, part: { raw: number; gzip: number; brotli: number }) =>
    `  ${label.padEnd(34)} ${fmt(part.raw).padStart(10)} ${fmt(part.gzip).padStart(10)} ${fmt(part.brotli).padStart(10)}`;
  return [
    `Page weight of /${id}/ from the build output (each file once)`,
    `  ${"".padEnd(34)} ${"raw".padStart(10)} ${"gzip".padStart(10)} ${"brotli".padStart(10)}`,
    row("HTML (inline scripts and styles in it)", weight.html),
    row(`CSS (${weight.css.files.length} files)`, weight.css),
    row(`fonts (${weight.fonts.files.length} files)`, weight.fonts),
    row("shared runtime (React, Astro client)", weight.js.shared),
    row("tool JS, initial", weight.js.initial),
    row("tool JS, on demand", weight.js.onDemand),
    row("total", weight.total),
  ].join("\n");
}
