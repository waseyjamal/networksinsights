// `pnpm check:budgets`, fourth section: the installable app (ADR 0052), measured on the real build
// output in apps/web/dist.
//
// Every page carries one more deferred file than the search loader: the script that registers the
// service worker. The build also writes the worker itself, the manifest and the icons. Each can go
// wrong without any test of the source noticing, so each is checked in the built files:
//
//   1. every page loads the registration script exactly once, as a module, and links the manifest;
//   2. the registration script stays within 1 KB gzip and the worker within its own budget, and
//      the worker is a classic script that imports nothing;
//   3. the manifest has what Chrome needs to install the site (name, short_name, start_url,
//      display, and 192 and 512 pixel PNG icons that exist and are that size), and the offline page
//      the worker falls back to exists.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import type { ContractViolation } from "@networksinsights/tool-sdk";
import { type FileWeight, resolveUrl, weigh } from "./budgets";
import { pngSize } from "./seo";

/** The most the registration script may weigh, gzip (ADR 0052). */
export const REGISTER_MAX_GZIP_BYTES = 1024;
/**
 * The most sw.js may weigh, gzip (ADR 0052). The browser fetches it in the background, once per
 * build, and it never blocks a page; the limit catches a chunk graph that has grown out of
 * proportion as tools are added.
 */
export const WORKER_MAX_GZIP_BYTES = 48 * 1024;

const REGISTER_FILE = /(?:^|\/)ServiceWorker\.astro_astro_type_script_[\w.-]+\.js$/;
const MANIFEST = "manifest.webmanifest";
const WORKER = "sw.js";
const OFFLINE = "offline/index.html";

/** The script that registers the service worker, which the search loader check leaves to this one. */
export function isServiceWorkerScript(path: string): boolean {
  return REGISTER_FILE.test(path);
}

export interface PwaReport {
  pages: number;
  register: FileWeight | undefined;
  worker: FileWeight | undefined;
  icons: number;
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

interface ManifestIcon {
  src?: unknown;
  sizes?: unknown;
  purpose?: unknown;
}

function checkManifest(distDir: string, problem: (text: string, fix: string) => void): number {
  const path = join(distDir, MANIFEST);
  if (!existsSync(path)) {
    problem("the build has no manifest", "src/pages/manifest.webmanifest.ts builds it");
    return 0;
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    problem("the manifest is not JSON", "build it with JSON.stringify");
    return 0;
  }
  for (const key of ["name", "short_name", "start_url", "display", "theme_color"]) {
    if (typeof manifest[key] !== "string" || manifest[key] === "") {
      problem(`the manifest has no ${key}`, "lib/pwa/manifest.ts sets it");
    }
  }
  if (!["standalone", "fullscreen", "minimal-ui"].includes(String(manifest.display))) {
    problem(`display is "${String(manifest.display)}"`, 'use "standalone"');
  }

  let checked = 0;
  const anySizes = new Set<number>();
  const icons = Array.isArray(manifest.icons) ? (manifest.icons as ManifestIcon[]) : [];
  for (const icon of icons) {
    const src = typeof icon.src === "string" ? icon.src : "";
    const file = resolveUrl(src, MANIFEST);
    const bytes =
      file && existsSync(join(distDir, file)) ? readFileSync(join(distDir, file)) : null;
    const size = bytes ? pngSize(bytes) : undefined;
    if (!size) {
      problem(`the icon ${src} is missing or not a PNG`, "check lib/pwa/paths.ts");
      continue;
    }
    if (icon.sizes !== `${size.width}x${size.height}` || size.width !== size.height) {
      problem(
        `the icon ${src} says ${String(icon.sizes)} but is ${size.width}x${size.height}`,
        "draw it at the size the manifest names",
      );
      continue;
    }
    checked++;
    if (icon.purpose === undefined || String(icon.purpose).split(" ").includes("any")) {
      anySizes.add(size.width);
    }
  }
  for (const needed of [192, 512]) {
    if (!anySizes.has(needed)) {
      problem(
        `the manifest has no ${needed}x${needed} icon for any purpose`,
        "Chrome needs a 192 and a 512 pixel icon to install the site",
      );
    }
  }
  return checked;
}

export function checkPwa(distDir: string): PwaReport {
  const report: PwaReport = {
    pages: 0,
    register: undefined,
    worker: undefined,
    icons: 0,
    violations: [],
  };
  if (!existsSync(distDir)) return report;
  const problem = (dir: string, text: string, fix: string) =>
    report.violations.push({ dir, gate: "budget", problem: text, fix });

  // Every page built from Base.astro carries the search dialog; other HTML files are not pages.
  const pages = walk(distDir)
    .map((path) => path.slice(distDir.length + 1).replaceAll("\\", "/"))
    .filter((path) => path.endsWith(".html"))
    .map((path) => ({ path, html: readFileSync(join(distDir, path), "utf8") }))
    .filter((page) => page.html.includes("data-ni-search"));
  report.pages = pages.length;
  if (pages.length === 0) return report;

  // 1. Once on every page, and the manifest linked.
  const registers = new Set<string>();
  for (const { path, html } of pages) {
    const tags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].flatMap((match) => {
      const file = resolveUrl(match[1] ?? "", path);
      return file && REGISTER_FILE.test(file) ? [{ tag: match[0], file }] : [];
    });
    if (tags.length !== 1) {
      problem(
        path,
        `has ${tags.length} service worker registration scripts; every page has exactly one`,
        "Base.astro renders components/layout/ServiceWorker.astro once, for every page (ADR 0052)",
      );
    }
    for (const { tag, file } of tags) {
      if (!/type="module"/.test(tag)) {
        problem(path, "loads the registration script as a classic script", "keep it a module");
      }
      registers.add(file);
    }
    if (!html.includes(`<link rel="manifest" href="/${MANIFEST}"`)) {
      problem(path, "does not link the manifest", "Base.astro links /manifest.webmanifest");
    }
  }
  if (registers.size > 1) {
    problem(
      [...registers].join(", "),
      "pages load different copies of the registration script",
      "every page must use the same file, so a visitor downloads it once",
    );
  }

  // 2. Budgets, and a worker with no imports.
  const register = [...registers].find((file) => existsSync(join(distDir, file)));
  if (register) {
    report.register = weigh(distDir, register);
    if (report.register.gzip > REGISTER_MAX_GZIP_BYTES) {
      problem(
        register,
        `the registration script is ${report.register.gzip} B gzip; the limit is ${REGISTER_MAX_GZIP_BYTES} B (ADR 0052)`,
        "the script only registers /sw.js after load: move anything else out of it",
      );
    }
  }
  if (existsSync(join(distDir, WORKER))) {
    report.worker = weigh(distDir, WORKER);
    if (report.worker.gzip > WORKER_MAX_GZIP_BYTES) {
      problem(
        WORKER,
        `sw.js is ${report.worker.gzip} B gzip; the limit is ${WORKER_MAX_GZIP_BYTES} B (ADR 0052)`,
        "the chunk graph in sw.js has grown: move it to its own file, or raise the limit with an ADR",
      );
    }
    const code = readFileSync(join(distDir, WORKER), "utf8");
    if (/^\s*(?:import|export)\b/m.test(code) || /\bimportScripts\s*\(/.test(code)) {
      problem(WORKER, "sw.js imports code", "the worker is one classic script with no imports");
    }
  } else {
    problem(WORKER, "the build has no service worker", "the service-worker integration writes it");
  }

  // 3. The offline page, the manifest and its icons.
  if (!existsSync(join(distDir, OFFLINE))) {
    problem(OFFLINE, "the build has no offline page", "src/pages/offline.astro builds it");
  }
  report.icons = checkManifest(distDir, (text, fix) => problem(MANIFEST, text, fix));
  return report;
}

const fmt = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

export function formatPwaReport(report: PwaReport): string {
  const lines = ["Installable app, gzip (ADR 0052)"];
  if (report.pages === 0) {
    lines.push("  There is no page in the build, so there is nothing to measure.");
    return lines.join("\n");
  }
  const rows: Array<[FileWeight | undefined, number, string]> = [
    [report.register, REGISTER_MAX_GZIP_BYTES, `deferred, on ${report.pages} pages`],
    [report.worker, WORKER_MAX_GZIP_BYTES, "fetched by the browser in the background"],
  ];
  for (const [file, max, note] of rows) {
    if (!file) continue;
    lines.push(
      `  ${file.gzip <= max ? "✓" : "✗"} ${posix.basename(file.path)}  ${fmt(file.gzip)} of ${fmt(max)}, ${note}`,
    );
  }
  lines.push(`  ${report.icons} manifest icons checked.`);
  return lines.join("\n");
}
