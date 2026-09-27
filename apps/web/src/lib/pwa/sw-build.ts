// Writes dist/sw.js after every build (ADR 0052): the service worker of lib/pwa/service-worker.ts,
// turned into plain JavaScript, with the settings of this build in front of it.
//
// The settings are read from the built files, never kept by hand: which file loads which (the same
// patterns as the budget check in scripts/lib/budgets.ts), and the shell, which is the offline
// page, the home page, /tools/, the manifest, the icons and every file those pages need.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";
import { iconFiles, MANIFEST_PATH, OFFLINE_PATH } from "./paths";
import { ASSET_PREFIX, closure, filesOfPage, type SwConfig } from "./service-worker";

/** Pages kept at install, besides the offline page. */
export const SHELL_PAGES = ["/", "/tools/"] as const;

// Built code quotes its strings with ", ' or a backtick, whichever the bundler chose.
const IMPORT_STATIC = /(?:\bfrom|\bimport)\s*["'`]([^"'`]+\.m?js)["'`]/g;
const IMPORT_DYNAMIC = /\bimport\(\s*["'`]([^"'`]+\.m?js)["'`]\s*\)/g;
const URL_ASSET =
  /new URL\(\s*["'`]([^"'`]+\.(?:wasm|m?js))["'`]\s*,\s*(?:(?:""|''|``)\s*\+\s*)?import\.meta\.url\s*\)/g;
const BARE_ASSET = /["'`](\/[^"'`\s]+\.wasm)["'`]/g;
const CSS_URL = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
/** Search is fetched only after intent (ADR 0046), so no edge leads the worker to it. */
const SEARCH_FILE = /^search-ui\.[\w-]+\.js$/;

function walk(dir: string, into: string[] = []): string[] {
  if (!existsSync(dir)) return into;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, into);
    else into.push(path);
  }
  return into;
}

/** A URL in a file under /_astro/, as a path under /_astro/, or undefined if it leads elsewhere. */
function underAssets(url: string, from: string): string | undefined {
  if (/^(?:[a-z]+:)?\/\//i.test(url) || url.startsWith("data:")) return undefined;
  const clean = url.split(/[?#]/)[0] ?? url;
  const path = clean.startsWith("/")
    ? clean.slice(1)
    : posix.normalize(posix.join(posix.dirname(`_astro/${from}`), clean));
  return path.startsWith("_astro/") ? path.slice("_astro/".length) : undefined;
}

/** Which file under dist/_astro loads which. Files that load nothing are left out. */
export function buildGraph(distDir: string): SwConfig["graph"] {
  const root = join(distDir, "_astro");
  const files = walk(root).map((path) => path.slice(root.length + 1).replaceAll("\\", "/"));
  const known = new Set(files);
  const graph: SwConfig["graph"] = {};
  for (const file of files.sort()) {
    const patterns = /\.m?js$/.test(file)
      ? [IMPORT_STATIC, IMPORT_DYNAMIC, URL_ASSET, BARE_ASSET]
      : file.endsWith(".css")
        ? [CSS_URL]
        : [];
    if (patterns.length === 0) continue;
    const text = readFileSync(join(root, file), "utf8");
    const edges = new Set<string>();
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const target = underAssets(match[1] ?? "", file);
        if (target && target !== file && known.has(target) && !SEARCH_FILE.test(target)) {
          edges.add(target);
        }
      }
    }
    if (edges.size > 0) graph[file] = [...edges].sort();
  }
  return graph;
}

/** dist/tools/index.html for /tools/, dist/index.html for /. */
function htmlOf(distDir: string, page: string): string {
  const file = join(distDir, ...page.split("/").filter(Boolean), "index.html");
  if (!existsSync(file)) throw new Error(`The service worker's shell needs ${page}, not built`);
  return readFileSync(file, "utf8");
}

export function buildConfig(distDir: string): SwConfig {
  const graph = buildGraph(distDir);
  const pages = [OFFLINE_PATH, ...SHELL_PAGES];
  const htmls = pages.map((page) => htmlOf(distDir, page));
  const files = closure(
    htmls.flatMap((html) => filesOfPage(html)),
    graph,
  ).filter((url) => !SEARCH_FILE.test(url.slice(ASSET_PREFIX.length)));
  const shell = [...pages, MANIFEST_PATH, ...iconFiles(), ...files.sort()];
  for (const url of shell) {
    const path = join(distDir, ...url.split("/").filter(Boolean));
    if (!url.endsWith("/") && !existsSync(path)) {
      throw new Error(`The service worker's shell names ${url}, which the build does not have`);
    }
  }
  // A new build of any page is a new worker: its hash covers every page and file the build made.
  const hash = createHash("sha256");
  for (const path of walk(distDir).sort()) {
    if (path.endsWith("sw.js") || path.endsWith("_headers")) continue;
    hash.update(path.slice(distDir.length).replaceAll("\\", "/"));
    hash.update(readFileSync(path));
  }
  return { version: hash.digest("hex").slice(0, 16), offline: OFFLINE_PATH, shell, graph };
}

/** The worker's code as plain JavaScript: the TypeScript stripped, no exports, no imports. */
export function workerSource(source: string): string {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      verbatimModuleSyntax: false,
    },
  });
  const code = outputText.replace(
    /^export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gm,
    "",
  );
  if (/^\s*(?:import|export)\b/m.test(code)) {
    throw new Error("lib/pwa/service-worker.ts must not import or re-export anything");
  }
  return code;
}

/** The whole of dist/sw.js. */
export function renderServiceWorker(source: string, config: SwConfig): string {
  return `// NetworksInsights service worker, build ${config.version} (ADR 0052). Generated; do not edit.
"use strict";
{
const CONFIG = ${JSON.stringify(config)};
${workerSource(source).trim()}
start(self, CONFIG);
}
`;
}
