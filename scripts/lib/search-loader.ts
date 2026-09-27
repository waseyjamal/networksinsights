// `pnpm check:budgets`, second section: the search loader (ADR 0046), measured on the real build
// output in apps/web/dist.
//
// Every page carries one deferred script, the loader, and nothing of search may reach a visitor
// before they show intent. That is three things a build can get wrong without any test of the
// source noticing, so each is checked in the built files:
//
//   1. the loader is one script file of at most 2 KB gzip, and imports nothing statically;
//   2. the search module is reached only through `import()`: no page and no other file imports it
//      statically, and no page names it or the index in a script, preload, prefetch or
//      modulepreload;
//   3. a page with no island has no other script than the loader and the theme script, and, in a
//      build with analytics, the two analytics files that analytics.ts checks (ADR 0051).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import type { ContractViolation } from "@networksinsights/tool-sdk";
import { isAnalyticsScript } from "./analytics";
import { edgesOf, type FileWeight, resolveUrl, weigh } from "./budgets";

/** The most the one loader script may weigh, gzip (ADR 0046). */
export const LOADER_MAX_GZIP_BYTES = 2048;

/** The built search module: `_astro/search-ui.<hash>.js`. */
const SEARCH_MODULE = /(?:^|\/)search-ui\.[\w-]+\.js$/;
const SEARCH_INDEX = /search-index\.[0-9a-f]+\.json/;
const DIALOG_MARKER = "data-ni-search";

export interface SearchLoaderReport {
  /** False when the build output has no page with the search dialog, so there was nothing to check. */
  measured: boolean;
  pages: number;
  /** Each distinct loader script the pages use, and what it weighs. */
  loaders: FileWeight[];
  /** The on-demand search module. */
  module: FileWeight | undefined;
  violations: ContractViolation[];
}

function walk(dir: string, into: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, into);
    else into.push(path);
  }
  return into;
}

const toPosix = (distDir: string, path: string) =>
  path
    .slice(distDir.length + 1)
    .split("\\")
    .join("/");

export function checkSearchLoader(distDir: string): SearchLoaderReport {
  const empty: SearchLoaderReport = {
    measured: false,
    pages: 0,
    loaders: [],
    module: undefined,
    violations: [],
  };
  if (!existsSync(distDir)) return empty;

  const files = walk(distDir).map((path) => toPosix(distDir, path));
  const htmlPaths = files.filter((path) => path.endsWith(".html"));
  const pages = htmlPaths.filter((path) =>
    readFileSync(join(distDir, path), "utf8").includes(DIALOG_MARKER),
  );

  const violations: ContractViolation[] = [];
  const problem = (page: string, text: string, fix: string) =>
    violations.push({ dir: page, gate: "budget", problem: text, fix });

  // The home page always has the dialog. If the build has a home page without it, that is the
  // failure, not a reason to skip the check.
  if (pages.length === 0) {
    if (htmlPaths.includes("index.html")) {
      problem(
        "index.html",
        "the built home page has no search dialog",
        "SearchDialog.astro must be rendered by layouts/Base.astro on every page (ADR 0046)",
      );
    }
    return { ...empty, violations };
  }

  const modulePath = files.find((path) => SEARCH_MODULE.test(path));
  if (!modulePath) {
    problem(
      pages[0] ?? "index.html",
      "the build has no search module (_astro/search-ui.<hash>.js)",
      "the loader's import() must name lib/search/search-ui.ts, and its file name must keep starting with search-ui",
    );
    return { ...empty, measured: true, pages: pages.length, violations };
  }

  // 2. Nothing imports the search module statically, in any built file.
  for (const path of files.filter((file) => /\.m?js$/.test(file))) {
    if (edgesOf(distDir, path).static.includes(modulePath)) {
      problem(
        path,
        `imports the search module statically, so it loads with this file instead of on intent`,
        "reach lib/search/search-ui.ts only through import(), from the loader in SearchDialog.astro",
      );
    }
  }

  const loaders = new Map<string, FileWeight>();
  for (const page of pages) {
    const html = readFileSync(join(distDir, page), "utf8");
    const hasIsland = html.includes("<astro-island");

    const sources = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].flatMap((match) => {
      const path = resolveUrl(match[1] ?? "", page);
      return path && existsSync(join(distDir, path)) ? [path] : [];
    });
    const loading = sources.filter((path) => edgesOf(distDir, path).dynamic.includes(modulePath));
    if (loading.length !== 1) {
      problem(
        page,
        `has ${loading.length} scripts that import the search module; it must have exactly one, the loader`,
        "SearchDialog.astro carries the loader and Base.astro renders it once",
      );
    }
    for (const loader of loading) {
      if (!loaders.has(loader)) loaders.set(loader, weigh(distDir, loader));
    }

    // 3. On a page with no island the loader is the only script file, and the theme script is the
    // only inline one. A page with an island also has Astro's own scripts.
    if (!hasIsland) {
      const others = sources.filter(
        (source) => !loading.includes(source) && !isAnalyticsScript(source),
      );
      for (const path of others) {
        problem(
          page,
          `loads the script ${path}, and this page has no island`,
          "a page without an island ships only the search loader and the inline theme script (ADR 0046)",
        );
      }
      const inline = [
        ...html.matchAll(/<script\b(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/g),
      ];
      if (inline.length !== 1) {
        problem(
          page,
          `has ${inline.length} inline scripts; a page without an island has exactly one, the theme script`,
          "do not add an inline script to a page or a layout (ADR 0028, ADR 0046)",
        );
      }
    }

    // Nothing of search is named where a browser would fetch it on its own.
    for (const tag of html.matchAll(/<link\b[^>]*>/g)) {
      const link = tag[0];
      if (
        /\brel="(?:preload|prefetch|modulepreload)"/.test(link) &&
        (SEARCH_MODULE.test(link.match(/\bhref="([^"]+)"/)?.[1] ?? "") || SEARCH_INDEX.test(link))
      ) {
        problem(
          page,
          `preloads search (${link.slice(0, 80)})`,
          "search is fetched only after intent: remove the preload or prefetch link (ADR 0046)",
        );
      }
    }
  }

  // 1. The loader: small, and no static imports.
  for (const loader of loaders.values()) {
    if (loader.gzip > LOADER_MAX_GZIP_BYTES) {
      violations.push({
        dir: loader.path,
        gate: "budget",
        problem: `the search loader is ${loader.gzip} B gzip; the limit is ${LOADER_MAX_GZIP_BYTES} B (ADR 0046)`,
        fix: "keep the loader to listening for intent and calling import(); move anything else into lib/search/search-ui.ts",
      });
    }
    const statics = edgesOf(distDir, loader.path).static;
    if (statics.length > 0) {
      violations.push({
        dir: loader.path,
        gate: "budget",
        problem: `the search loader imports ${statics.join(", ")} statically, so it loads with every page`,
        fix: "the loader may import only small pure helpers that are bundled into it; anything shared with the search module must be reached through the module",
      });
    }
  }

  return {
    measured: true,
    pages: pages.length,
    loaders: [...loaders.values()],
    module: weigh(distDir, modulePath),
    violations,
  };
}

const KB = 1024;
const fmt = (bytes: number) => `${(bytes / KB).toFixed(1)} KB`;

/** The section of the report the owner reads. `indent` lines up with the tool table above it. */
export function formatSearchLoaderReport(report: SearchLoaderReport): string {
  const lines = ["Search loader, gzip (ADR 0046)"];
  if (!report.measured) {
    lines.push(
      "  There is no page with the search dialog in the build, so there is nothing to measure.",
    );
    return lines.join("\n");
  }
  for (const loader of report.loaders) {
    const mark = loader.gzip <= LOADER_MAX_GZIP_BYTES ? "✓" : "✗";
    lines.push(
      `  ${mark} ${posix.basename(loader.path)}  ${fmt(loader.gzip)} of ${fmt(LOADER_MAX_GZIP_BYTES)}, on ${report.pages} pages, loaded on every page`,
    );
  }
  if (report.module) {
    lines.push(
      `    ${posix.basename(report.module.path)}  ${fmt(report.module.gzip)}, loaded only after intent`,
    );
  }
  if (report.violations.length === 0)
    lines.push("  Search stays out of the page until a visitor shows intent.");
  return lines.join("\n");
}
