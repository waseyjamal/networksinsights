import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type BudgetTarget,
  budgetReportToJson,
  checkBudgets,
  formatBudgetReport,
  formatPageWeight,
  measurePageJs,
  measurePageWeight,
} from "./lib/budgets";
import { LAME_WASM_PATH } from "./lib/lame-copies";
import { ONNXRUNTIME_PAGES, ONNXRUNTIME_WASM_PATH } from "./lib/onnxruntime-pages";
import { scratchRoot } from "./lib/test-support";
import { repoRoot } from "./lib/tools";

// The per-tool JavaScript budgets (ADR 0037), against small built sites written to disk. Each one
// has the shape of real Astro output: an <astro-island> whose component chunk imports the shared
// React chunk, and a renderer chunk that imports it too.

const roots: Array<ReturnType<typeof scratchRoot>> = [];
afterEach(() => {
  for (const scratch of roots.splice(0)) scratch.remove();
});

const KB = 1024;
/** About `kb` KB of gzip: random bytes do not compress. */
const noise = (kb: number) => randomBytes(Math.round(kb * KB)).toString("base64");

interface Site {
  /** JS the island's chunk holds after its imports. */
  staticKb?: number;
  /** A chunk imported with import() when a button is pressed. */
  lazyKb?: number;
  /** A .wasm file loaded by URL. */
  wasmKb?: number;
  /** A chunk the lazy chunk imports statically: it loads with the lazy one. */
  lazyDependencyKb?: number;
  quote?: '"' | "`";
}

function build(site: Site = {}) {
  const scratch = scratchRoot();
  roots.push(scratch);
  const dist = join(scratch.root, "dist");
  const put = (path: string, content: string | Buffer) => {
    mkdirSync(dirname(join(dist, path)), { recursive: true });
    writeFileSync(join(dist, path), content);
  };
  const q = site.quote ?? '"';

  put(
    "word-counter/index.html",
    `<!doctype html><html><head><link rel="stylesheet" href="/_astro/site.css"></head><body><astro-island uid="x" component-url="/_astro/ui.AAA.js" component-export="default" renderer-url="/_astro/client.BBB.js" client="load"></astro-island></body></html>`,
  );
  put("_astro/site.css", "body{margin:0}".repeat(50));
  put("_astro/client.BBB.js", `import${q}./react.CCC.js${q};export default ()=>{};${noise(60)}`);
  put("_astro/react.CCC.js", `export const React=1;${noise(3)}`);

  const lines = [`import${q}./react.CCC.js${q};`, `import{a}from${q}./shared.DDD.js${q};`];
  if (site.lazyKb !== undefined) {
    lines.push(`export const load=()=>import(${q}./engine.EEE.js${q});`);
  }
  if (site.wasmKb !== undefined) {
    lines.push(`export const wasm=new URL(${q}./engine.FFF.wasm${q},import.meta.url);`);
  }
  put("_astro/shared.DDD.js", `export const a=1;${noise(1)}`);
  put("_astro/ui.AAA.js", `${lines.join("")}export default ()=>a;${noise(site.staticKb ?? 2)}`);
  if (site.lazyKb !== undefined) {
    const dependency = site.lazyDependencyKb === undefined ? "" : `import${q}./dep.GGG.js${q};`;
    put("_astro/engine.EEE.js", `${dependency}export const engine=1;${noise(site.lazyKb)}`);
  }
  if (site.lazyDependencyKb !== undefined) {
    put("_astro/dep.GGG.js", `export const dep=1;${noise(site.lazyDependencyKb)}`);
  }
  if (site.wasmKb !== undefined) put("_astro/engine.FFF.wasm", randomBytes(site.wasmKb * KB));
  return { dist, put, root: scratch.root };
}

const target = (budget?: BudgetTarget["budget"]): BudgetTarget => ({
  id: "word-counter",
  dir: "tools/text/word-counter",
  budget,
});
const kb = (bytes: number) => bytes / KB;

describe("what counts as the tool's own JavaScript", () => {
  it("charges the island's static code, and not the shared renderer or the React it imports", () => {
    const { dist } = build({ staticKb: 4 });
    const js = measurePageJs(dist, "word-counter/index.html");
    expect(js?.initial.files.map((file) => file.path)).toEqual([
      "_astro/shared.DDD.js",
      "_astro/ui.AAA.js",
    ]);
    expect(js?.shared.files.map((file) => file.path)).toEqual([
      "_astro/client.BBB.js",
      "_astro/react.CCC.js",
    ]);
    expect(kb(js?.initial.gzip ?? 0)).toBeGreaterThan(4);
    expect(kb(js?.initial.gzip ?? 0)).toBeLessThan(8);
    expect(js?.onDemand.files).toEqual([]);
    // The renderer is 60 KB, and none of it is charged to the tool.
    expect(kb(js?.shared.gzip ?? 0)).toBeGreaterThan(55);
  });

  it("charges a dynamic import to the on-demand number, with what that chunk imports", {
    tags: ["slow"],
  }, () => {
    const { dist } = build({ staticKb: 2, lazyKb: 30, lazyDependencyKb: 20 });
    const js = measurePageJs(dist, "word-counter/index.html");
    expect(kb(js?.initial.gzip ?? 0)).toBeLessThan(6);
    expect(js?.onDemand.files.map((file) => file.path)).toEqual([
      "_astro/dep.GGG.js",
      "_astro/engine.EEE.js",
    ]);
    expect(kb(js?.onDemand.gzip ?? 0)).toBeGreaterThan(48);
  });

  it("charges a .wasm file loaded by URL to the on-demand number", { tags: ["slow"] }, () => {
    const { dist } = build({ staticKb: 2, wasmKb: 300 });
    const js = measurePageJs(dist, "word-counter/index.html");
    expect(js?.onDemand.files.map((file) => file.path)).toEqual(["_astro/engine.FFF.wasm"]);
    expect(kb(js?.onDemand.gzip ?? 0)).toBeGreaterThan(290);
    expect(kb(js?.initial.gzip ?? 0)).toBeLessThan(6);
  });

  it("charges a worker script to the on-demand number, in the form Vite writes it", () => {
    const { dist, put } = build({ staticKb: 2 });
    put(
      "_astro/ui.AAA.js",
      "import`./react.CCC.js`;import{a}from`./shared.DDD.js`;" +
        "export const w=()=>new Worker(new URL(`/_astro/worker-HHH.js`,``+import.meta.url),{type:`module`});" +
        "export default ()=>a;",
    );
    put("_astro/worker-HHH.js", "self.onmessage=()=>{};");
    const js = measurePageJs(dist, "word-counter/index.html");
    expect(js?.onDemand.files.map((file) => file.path)).toEqual(["_astro/worker-HHH.js"]);
    expect(js?.initial.files.map((file) => file.path)).not.toContain("_astro/worker-HHH.js");
  });

  it("reads imports quoted with backticks, as the bundler writes them", () => {
    const { dist } = build({ staticKb: 2, lazyKb: 10, quote: "`" });
    const js = measurePageJs(dist, "word-counter/index.html");
    expect(js?.onDemand.files.map((file) => file.path)).toEqual(["_astro/engine.EEE.js"]);
  });

  it("finds no island on a page that has none", () => {
    const { dist, put } = build();
    put("plain/index.html", "<!doctype html><p>no island</p>");
    expect(measurePageJs(dist, "plain/index.html")).toBeUndefined();
  });
});

describe("the initial budget: 40 KB gzip by default", () => {
  it("passes a small tool", () => {
    const { dist } = build({ staticKb: 5 });
    const report = checkBudgets(dist, [target()]);
    expect(report.ok).toBe(true);
    expect(report.results[0]?.budget).toEqual({ initialKb: 40, onDemandKb: 1024 });
  });

  it("fails a tool over it, naming the tool, the file, the size, the limit and the fix", {
    tags: ["slow"],
  }, () => {
    const { dist } = build({ staticKb: 60 });
    const [violation] = checkBudgets(dist, [target()]).results[0]?.violations ?? [];
    expect(violation?.dir).toBe("tools/text/word-counter");
    expect(violation?.file).toBe("ui.tsx");
    expect(violation?.problem).toMatch(
      /initial island JavaScript is 6\d\.\d KB gzip; the budget is 40 KB/,
    );
    expect(violation?.fix).toContain('const engine = await import("./engine")');
    expect(violation?.fix).toContain("budget: { maxInitialJsKb:");
    expect(violation?.fix).toContain("_astro/ui.AAA.js");
  });

  it("is the same 60 KB, and passes, once loaded on demand: lazy loading is rewarded", {
    tags: ["slow"],
  }, () => {
    const eager = checkBudgets(build({ staticKb: 60 }).dist, [target()]);
    const lazy = checkBudgets(build({ staticKb: 2, lazyKb: 60 }).dist, [target()]);
    expect(eager.ok).toBe(false);
    expect(lazy.ok).toBe(true);
    expect(kb(lazy.results[0]?.js?.onDemand.gzip ?? 0)).toBeGreaterThan(55);
  });

  it("is raised by a manifest budget, and the report says so", { tags: ["slow"] }, () => {
    const { dist } = build({ staticKb: 60 });
    const raised = target({
      maxInitialJsKb: 80,
      reason: "Bundles a parser that must run at once.",
    });
    const report = checkBudgets(dist, [raised]);
    expect(report.ok).toBe(true);
    expect(report.results[0]?.raised).toBe(true);
    expect(report.results[0]?.budget.initialKb).toBe(80);
    expect(formatBudgetReport(report)).toContain("(raised in tool.config.ts)");
  });

  it("cannot be raised past the ceiling: the message says the code has to shrink", {
    tags: ["slow"],
  }, () => {
    const { dist } = build({ staticKb: 300 });
    const raised = target({ maxInitialJsKb: 250, reason: "As much as is allowed here." });
    const [violation] = checkBudgets(dist, [raised]).results[0]?.violations ?? [];
    expect(violation?.fix).toContain("the ceiling is 250 KB and cannot be raised without an ADR");
  });
});

describe("the on-demand budget: 1,024 KB gzip by default, failing separately", () => {
  it("passes a heavy engine loaded after a user action, which a PDF or media tool needs", {
    tags: ["slow"],
  }, () => {
    const report = checkBudgets(build({ staticKb: 3, lazyKb: 500, wasmKb: 400 }).dist, [target()]);
    expect(report.ok).toBe(true);
    expect(kb(report.results[0]?.js?.onDemand.gzip ?? 0)).toBeGreaterThan(890);
  });

  it("fails when what is fetched later is over its own budget, and initial still passes", {
    tags: ["slow"],
  }, () => {
    const { dist } = build({ staticKb: 3, lazyKb: 1100 });
    const [violation, ...rest] = checkBudgets(dist, [target()]).results[0]?.violations ?? [];
    expect(rest).toEqual([]);
    expect(violation?.problem).toMatch(
      /on-demand JavaScript \(dynamic imports, \.wasm files, workers\) is 1\d{3}\.\d KB gzip; the budget is 1024 KB/,
    );
    expect(violation?.fix).toContain("maxOnDemandJsKb");
  });

  it("is raised by a manifest budget up to its ceiling", { tags: ["slow"] }, () => {
    const { dist } = build({ staticKb: 3, lazyKb: 1100 });
    const raised = target({ maxOnDemandJsKb: 2048, reason: "Ships a WebAssembly PDF engine." });
    expect(checkBudgets(dist, [raised]).ok).toBe(true);
  });

  it("fails initial and on demand separately when both are over", { tags: ["slow"] }, () => {
    const { dist } = build({ staticKb: 60, lazyKb: 1100 });
    const violations = checkBudgets(dist, [target()]).results[0]?.violations ?? [];
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.problem.split(" ")[0])).toEqual(["initial", "on-demand"]);
  });
});

describe("a page that cannot be measured", () => {
  it("says to run the build when there is no built page", () => {
    const { dist } = build();
    const [violation] =
      checkBudgets(dist, [{ ...target(), id: "missing-tool" }]).results[0]?.violations ?? [];
    expect(violation?.problem).toContain("has no built page at missing-tool/index.html");
    expect(violation?.fix).toContain("pnpm build");
  });

  it("says island.astro when the built page has no island", () => {
    const { dist, put } = build();
    put("plain/index.html", "<!doctype html><p>no island</p>");
    const [violation] =
      checkBudgets(dist, [{ ...target(), id: "plain" }]).results[0]?.violations ?? [];
    expect(violation?.file).toBe("island.astro");
  });

  it("passes when there are no tools at all", () => {
    const report = checkBudgets(build().dist, []);
    expect(report.ok).toBe(true);
    expect(formatBudgetReport(report)).toContain("no tool pages in the build");
  });
});

describe("the report", () => {
  it("prints initial and on demand side by side, each against its own budget", () => {
    const { dist } = build({ staticKb: 5, lazyKb: 40 });
    const text = formatBudgetReport(checkBudgets(dist, [target()]));
    expect(text).toMatch(
      /✓ word-counter\s+initial \d+\.\d \/ 40 KB\s+on demand \d+\.\d \/ 1024 KB/,
    );
    expect(text).toContain("All tool pages are within budget.");
  });

  it("is JSON an agent can read", { tags: ["slow"] }, () => {
    const { dist } = build({ staticKb: 60 });
    const json = JSON.parse(budgetReportToJson(checkBudgets(dist, [target()])));
    expect(json.ok).toBe(false);
    expect(json.tools[0]).toMatchObject({
      id: "word-counter",
      budgetKb: { initial: 40, onDemand: 1024 },
    });
    expect(json.tools[0].problems[0].fix).toContain("import(");
  });

  it("adds up the whole page: HTML, CSS, the shared runtime and the tool, each file once", () => {
    const { dist } = build({ staticKb: 5, lazyKb: 10 });
    const weight = measurePageWeight(dist, "word-counter");
    expect(weight?.css.files.map((file) => file.path)).toEqual(["_astro/site.css"]);
    const parts =
      (weight?.html.gzip ?? 0) +
      (weight?.css.gzip ?? 0) +
      (weight?.js.shared.gzip ?? 0) +
      (weight?.js.initial.gzip ?? 0) +
      (weight?.js.onDemand.gzip ?? 0);
    expect(weight?.total.gzip).toBe(parts);
    expect(formatPageWeight("word-counter", weight as NonNullable<typeof weight>)).toContain(
      "total",
    );
  });
});

describe("the command", () => {
  it("measures this repository's tools in a build and passes when they fit", {
    tags: ["slow"],
  }, () => {
    const { dist, put } = build();
    // The same small page for every real tool of this repository, whatever tools it has.
    const page = readFileSync(join(dist, "word-counter", "index.html"), "utf8");
    const ids = readdirSync(join(repoRoot, "tools"), { withFileTypes: true })
      .filter((category) => category.isDirectory() && category.name !== "node_modules")
      .flatMap((category) =>
        readdirSync(join(repoRoot, "tools", category.name), { withFileTypes: true })
          .filter((tool) =>
            existsSync(join(repoRoot, "tools", category.name, tool.name, "tool.config.ts")),
          )
          .map((tool) => tool.name),
      );
    for (const id of ids) put(`${id}/index.html`, page);
    // A real build carries LAME once, as the vendored wasm, and check:budgets checks that.
    mkdirSync(dirname(join(dist, LAME_WASM_PATH)), { recursive: true });
    copyFileSync(
      join(repoRoot, "tools", "node_modules", "wasm-media-encoders", "wasm", "mp3.wasm"),
      join(dist, LAME_WASM_PATH),
    );
    // And ONNX Runtime once, as its vendored wasm, reached only from the AI image tools' pages.
    mkdirSync(dirname(join(dist, ONNXRUNTIME_WASM_PATH)), { recursive: true });
    copyFileSync(
      join(
        repoRoot,
        "tools",
        "node_modules",
        "onnxruntime-web",
        "dist",
        "ort-wasm-simd-threaded.wasm",
      ),
      join(dist, ONNXRUNTIME_WASM_PATH),
    );
    put("_astro/worker-ort.js", "/*! ONNX Runtime Web v1.30.0 */ export {};");
    put(
      "_astro/ui-ort.js",
      'new Worker(new URL("/_astro/worker-ort.js", "" + import.meta.url), { type: "module" });',
    );
    const ortPage = page.replace(/component-url="[^"]+"/, 'component-url="/_astro/ui-ort.js"');
    expect(ortPage).not.toBe(page);
    for (const path of ONNXRUNTIME_PAGES) put(path, ortPage);
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/check-budgets.ts", "--dist", dist],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(ids).toContain("word-counter");
    for (const id of ids) expect(result.stdout).toMatch(new RegExp(`✓ ${id}\\s+initial`));
  });

  it("refuses an option it does not know, with exit code 2", { tags: ["slow"] }, () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/check-budgets.ts", "--nonsense"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage: pnpm check:budgets");
  });
});
