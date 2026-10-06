// pnpm check:budgets [--tool <id>] [--report] [--json] [--dist <folder>]
//
// Measures the JavaScript of every tool page in the real build output (apps/web/dist) against its
// budget (ADR 0037): the initial island code, and the code fetched on demand, separately. It also
// checks the search loader that every page carries (ADR 0046): at most 2 KB gzip, and nothing of
// search fetched before a visitor shows intent; in a build with analytics, the two analytics files
// (ADR 0051); and the installable app: the service worker, its registration script, the manifest
// and its icons (ADR 0052); and that the LAME MP3 encoder is in the build exactly once, as its
// vendored wasm (ADR 0064), and that ONNX Runtime reaches only the AI image tools, its wasm once
// (ADR 0066). Run it after `pnpm build`. CI runs it on every
// pull request. Exit code 0 means every page is within budget; 1 means a page is over; 2 means the
// command was used wrongly.

import { join } from "node:path";
import { parseArgs } from "node:util";
import { formatViolation, indentMessage, toolManifestSchema } from "@networksinsights/tool-sdk";
import { checkAnalytics, formatAnalyticsReport } from "./lib/analytics";
import {
  budgetReportToJson,
  checkBudgets,
  formatBudgetReport,
  formatPageWeight,
  measurePageWeight,
} from "./lib/budgets";
import { checkLameCopies, formatLameReport } from "./lib/lame-copies";
import { checkOnnxruntimePages, formatOnnxruntimeReport } from "./lib/onnxruntime-pages";
import { checkPwa, formatPwaReport } from "./lib/pwa";
import { checkSearchLoader, formatSearchLoaderReport } from "./lib/search-loader";
import { defaultToolsRoot, loadTools, repoRoot } from "./lib/tools";

const HELP = `Usage: pnpm check:budgets [--tool <id>] [--report] [--json] [--dist <folder>]

Measures each tool page's JavaScript in the build output, so run \`pnpm build\` first.

  --tool <id>     measure one tool
  --report        also print the total page weight of each measured page
  --json          print the result as JSON
  --dist <path>   the build output; defaults to apps/web/dist
  --help          show this text`;

async function main(): Promise<number> {
  let values: {
    tool?: string | undefined;
    report?: boolean | undefined;
    json?: boolean | undefined;
    dist?: string | undefined;
    help?: boolean | undefined;
  };
  try {
    ({ values } = parseArgs({
      options: {
        tool: { type: "string" },
        report: { type: "boolean" },
        json: { type: "boolean" },
        dist: { type: "string" },
        help: { type: "boolean" },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const distDir = values.dist ?? join(repoRoot, "apps", "web", "dist");
  const loaded = await loadTools(defaultToolsRoot);
  const targets = loaded.flatMap((tool) => {
    const parsed = toolManifestSchema.safeParse(tool.entry.manifest);
    // A manifest that does not parse is check:tools's to report, not a budget question.
    if (!parsed.success) return [];
    return [{ id: parsed.data.id, dir: tool.entry.dir, budget: parsed.data.budget }];
  });

  const chosen = values.tool === undefined ? targets : targets.filter((t) => t.id === values.tool);
  if (values.tool !== undefined && chosen.length === 0) {
    console.error(
      `There is no tool with the id "${values.tool}" in tools/. A tool's id is the name of its folder.`,
    );
    return 2;
  }

  const report = checkBudgets(distDir, chosen);
  const loader = checkSearchLoader(distDir);
  const analytics = checkAnalytics(distDir);
  const pwa = checkPwa(distDir);
  const lame = checkLameCopies(distDir);
  const onnxruntime = checkOnnxruntimePages(distDir);
  const ok =
    lame.ok &&
    onnxruntime.ok &&
    report.ok &&
    loader.violations.length === 0 &&
    analytics.violations.length === 0 &&
    pwa.violations.length === 0;
  if (values.json) {
    console.log(
      JSON.stringify(
        {
          ...JSON.parse(budgetReportToJson(report)),
          ok,
          searchLoader: {
            ok: loader.violations.length === 0,
            measured: loader.measured,
            pages: loader.pages,
            loaders: loader.loaders.map((file) => ({
              path: file.path,
              gzip: file.gzip,
              raw: file.raw,
            })),
            moduleGzip: loader.module?.gzip ?? null,
            problems: loader.violations.map((v) => ({
              page: v.dir,
              problem: v.problem,
              fix: v.fix,
            })),
          },
          analytics: {
            ok: analytics.violations.length === 0,
            on: analytics.on,
            pages: analytics.pages,
            trackerGzip: analytics.tracker?.gzip ?? null,
            eventsGzip: analytics.events?.gzip ?? null,
            problems: analytics.violations.map((v) => ({
              page: v.dir,
              problem: v.problem,
              fix: v.fix,
            })),
          },
          lame: { ok: lame.ok, copies: lame.copies },
          onnxruntime,
          pwa: {
            ok: pwa.violations.length === 0,
            pages: pwa.pages,
            registerGzip: pwa.register?.gzip ?? null,
            workerGzip: pwa.worker?.gzip ?? null,
            icons: pwa.icons,
            problems: pwa.violations.map((v) => ({ page: v.dir, problem: v.problem, fix: v.fix })),
          },
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatBudgetReport(report));
    console.log(`
${formatSearchLoaderReport(loader)}`);
    console.log(`
${formatAnalyticsReport(analytics)}`);
    console.log(`
${formatPwaReport(pwa)}`);
    console.log(`
${formatLameReport(lame)}`);
    console.log(`
${formatOnnxruntimeReport(onnxruntime)}`);
    const sections: Array<[string, typeof loader.violations]> = [
      ["search", loader.violations],
      ["analytics", analytics.violations],
      ["installable app", pwa.violations],
    ];
    for (const [name, violations] of sections) {
      if (violations.length === 0) continue;
      console.log(
        `
${violations.length} ${name} ${violations.length === 1 ? "problem" : "problems"} to fix:
`,
      );
      for (const violation of violations) {
        console.log(
          indentMessage(
            formatViolation(violation).replace('Quality gate "budget":', "JavaScript budget:"),
          ),
        );
      }
    }
  }
  if (values.report && !values.json) {
    for (const target of chosen) {
      const weight = measurePageWeight(distDir, target.id);
      if (weight) console.log(`\n${formatPageWeight(target.id, weight)}`);
    }
  }
  return ok ? 0 : 1;
}

process.exitCode = await main();
