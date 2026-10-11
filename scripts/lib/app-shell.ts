// `pnpm check:budgets`, fifth section: the app shell (ADR 0072), measured on the real build output
// in apps/web/dist.
//
// Every page carries one more deferred file than the search loader and the service worker's
// registration: the app shell, which shows the navigation bar and drives the "Install app"
// control. It is checked in the built files like the registration script:
//
//   1. every page loads it exactly once, as a module, and every page loads the same file;
//   2. it stays within 1 KB gzip and imports nothing, statically or with import(), so the file
//      is the whole cost and nothing else can ride along with it.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import type { ContractViolation } from "@networksinsights/tool-sdk";
import { edgesOf, type FileWeight, resolveUrl, weigh } from "./budgets";

/** The most the app shell may weigh, gzip (ADR 0072). */
export const APP_SHELL_MAX_GZIP_BYTES = 1024;

const APP_SHELL_FILE = /(?:^|\/)AppShell\.astro_astro_type_script_[\w.-]+\.js$/;

/** The app shell script, which the search loader check leaves to this one. */
export function isAppShellScript(path: string): boolean {
  return APP_SHELL_FILE.test(path);
}

export interface AppShellReport {
  pages: number;
  script: FileWeight | undefined;
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

export function checkAppShell(distDir: string): AppShellReport {
  const report: AppShellReport = { pages: 0, script: undefined, violations: [] };
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

  // 1. Once on every page, as a module, the same file everywhere.
  const files = new Set<string>();
  for (const { path, html } of pages) {
    const tags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].flatMap((match) => {
      const file = resolveUrl(match[1] ?? "", path);
      return file && APP_SHELL_FILE.test(file) ? [{ tag: match[0], file }] : [];
    });
    if (tags.length !== 1) {
      problem(
        path,
        `has ${tags.length} app shell scripts; every page has exactly one`,
        "Base.astro renders components/layout/AppShell.astro once, for every page (ADR 0072)",
      );
    }
    for (const { tag, file } of tags) {
      if (!/type="module"/.test(tag)) {
        problem(path, "loads the app shell as a classic script", "keep it a module");
      }
      files.add(file);
    }
  }
  if (files.size > 1) {
    problem(
      [...files].join(", "),
      "pages load different copies of the app shell",
      "every page must use the same file, so a visitor downloads it once",
    );
  }

  // 2. Small, and it imports nothing.
  const script = [...files].find((file) => existsSync(join(distDir, file)));
  if (script) {
    report.script = weigh(distDir, script);
    if (report.script.gzip > APP_SHELL_MAX_GZIP_BYTES) {
      problem(
        script,
        `the app shell is ${report.script.gzip} B gzip; the limit is ${APP_SHELL_MAX_GZIP_BYTES} B (ADR 0072)`,
        "the shell only shows the navigation bar and the install control: move anything else out of it",
      );
    }
    const edges = edgesOf(distDir, script);
    const imported = [...edges.static, ...edges.dynamic];
    if (imported.length > 0) {
      problem(
        script,
        `the app shell imports ${imported.join(", ")}`,
        "the shell is one file that imports nothing (ADR 0072)",
      );
    }
  }
  return report;
}

const fmt = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

export function formatAppShellReport(report: AppShellReport): string {
  const lines = ["App shell, gzip (ADR 0072)"];
  if (report.pages === 0) {
    lines.push("  There is no page in the build, so there is nothing to measure.");
    return lines.join("\n");
  }
  const { script } = report;
  if (script) {
    lines.push(
      `  ${script.gzip <= APP_SHELL_MAX_GZIP_BYTES ? "✓" : "✗"} ${posix.basename(script.path)}  ${fmt(script.gzip)} of ${fmt(APP_SHELL_MAX_GZIP_BYTES)}, deferred, on ${report.pages} pages`,
    );
  }
  return lines.join("\n");
}
