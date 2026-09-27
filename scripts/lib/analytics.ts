// `pnpm check:budgets`, third section: the analytics scripts (ADR 0051), measured on the real build
// output in apps/web/dist.
//
// A build with analytics carries two more deferred files on every page than the search loader:
// Umami's tracker, served from our origin, and our small tool-used and error script. Each is
// checked here, because a build can get them wrong without any test of the source noticing:
//
//   1. every page has each file exactly once, the tracker as a classic `defer` script (it reads
//      its settings from `document.currentScript`, which a module does not have);
//   2. the tracker is byte for byte the reviewed copy: the build did not transform it;
//   3. each stays within its gzip budget, and neither imports another file.
//
// A build without a website id has neither file, and the section says analytics are off.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import type { ContractViolation } from "@networksinsights/tool-sdk";
import { TRACKER } from "../../apps/web/src/config/analytics";
import { edgesOf, type FileWeight, resolveUrl, weigh } from "./budgets";

/** The most Umami's tracker may weigh, gzip. It is 2.3 KB (v3.4.0). */
export const TRACKER_MAX_GZIP_BYTES = 3072;
/** The most our tool-used and error script may weigh, gzip. */
export const EVENTS_MAX_GZIP_BYTES = 1024;

const TRACKER_FILE = /(?:^|\/)umami-tracker\.[\w-]+\.js$/;
const EVENTS_FILE = /(?:^|\/)Analytics\.astro_astro_type_script_[\w.-]+\.js$/;

/** A script file that belongs to analytics, which the search loader check leaves to this one. */
export function isAnalyticsScript(path: string): boolean {
  return TRACKER_FILE.test(path) || EVENTS_FILE.test(path);
}

export interface AnalyticsReport {
  /** False when no page carries the tracker: the build has analytics off. */
  on: boolean;
  pages: number;
  tracker: FileWeight | undefined;
  events: FileWeight | undefined;
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

export function checkAnalytics(distDir: string): AnalyticsReport {
  const off: AnalyticsReport = {
    on: false,
    pages: 0,
    tracker: undefined,
    events: undefined,
    violations: [],
  };
  if (!existsSync(distDir)) return off;

  const htmlPaths = walk(distDir)
    .map((path) => path.slice(distDir.length + 1).replaceAll("\\", "/"))
    .filter((path) => path.endsWith(".html"));
  // Every page built from Base.astro carries the search dialog; other HTML files are not pages.
  const pages = htmlPaths
    .map((path) => ({ path, html: readFileSync(join(distDir, path), "utf8") }))
    .filter((page) => page.html.includes("data-ni-search"));
  if (!pages.some((page) => /umami-tracker\.[\w-]+\.js/.test(page.html))) return off;

  const violations: ContractViolation[] = [];
  const problem = (dir: string, text: string, fix: string) =>
    violations.push({ dir, gate: "budget", problem: text, fix });

  const files = new Set<string>();
  let tracker: string | undefined;
  let events: string | undefined;
  for (const { path, html } of pages) {
    const tags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].flatMap((match) => {
      const file = resolveUrl(match[1] ?? "", path);
      return file ? [{ tag: match[0], file }] : [];
    });
    const trackers = tags.filter((t) => TRACKER_FILE.test(t.file));
    const scripts = tags.filter((t) => EVENTS_FILE.test(t.file));

    // 1. Once each, on every page.
    if (trackers.length !== 1 || scripts.length !== 1) {
      problem(
        path,
        `has ${trackers.length} tracker and ${scripts.length} analytics scripts; every page has exactly one of each`,
        "Base.astro renders components/layout/Analytics.astro once, for every page (ADR 0051)",
      );
    }
    for (const { tag, file } of trackers) {
      if (!/\sdefer\b/.test(tag) || /type="module"/.test(tag)) {
        problem(
          path,
          "loads the tracker without `defer`, or as a module",
          "keep the tracker a classic deferred script: it reads its settings from document.currentScript",
        );
      }
      tracker ??= file;
      files.add(file);
    }
    for (const { file } of scripts) {
      events ??= file;
      files.add(file);
    }
  }

  for (const file of files) {
    if (!existsSync(join(distDir, file))) {
      problem(file, "is named by a page but missing from the build", "rebuild with `pnpm build`");
      files.delete(file);
    }
  }
  if (files.size > 2) {
    problem(
      [...files].join(", "),
      "pages load different copies of the analytics scripts",
      "every page must use the same two files, so a visitor downloads them once",
    );
  }

  // 2. The reviewed copy, unchanged by the build.
  const trackerWeight = tracker && files.has(tracker) ? weigh(distDir, tracker) : undefined;
  if (tracker && trackerWeight) {
    const hash = createHash("sha256")
      .update(readFileSync(join(distDir, tracker)))
      .digest("hex");
    if (hash !== TRACKER.sha256) {
      problem(
        tracker,
        "the built tracker is not the reviewed copy (its SHA-256 differs from TRACKER.sha256)",
        "import lib/analytics/umami-tracker.js with ?url&no-inline so the build copies it as is",
      );
    }
  }

  // 3. Budgets, and no imports.
  const eventsWeight = events && files.has(events) ? weigh(distDir, events) : undefined;
  const limits: Array<[FileWeight | undefined, number, string]> = [
    [trackerWeight, TRACKER_MAX_GZIP_BYTES, "the tracker"],
    [eventsWeight, EVENTS_MAX_GZIP_BYTES, "the tool-used and error script"],
  ];
  for (const [file, max, name] of limits) {
    if (!file) continue;
    if (file.gzip > max) {
      problem(
        file.path,
        `${name} is ${file.gzip} B gzip; the limit is ${max} B (ADR 0051)`,
        "analytics must stay small: move work out of it, or raise the limit with an ADR",
      );
    }
    const edges = edgesOf(distDir, file.path);
    if (edges.static.length > 0 || edges.dynamic.length > 0) {
      problem(
        file.path,
        `${name} imports ${[...edges.static, ...edges.dynamic].join(", ")}`,
        "the analytics scripts are single files: bundle what they need into them",
      );
    }
  }

  return {
    on: true,
    pages: pages.length,
    tracker: trackerWeight,
    events: eventsWeight,
    violations,
  };
}

const fmt = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

export function formatAnalyticsReport(report: AnalyticsReport): string {
  const lines = ["Analytics, gzip (ADR 0051)"];
  if (!report.on) {
    lines.push("  Off: this build has no UMAMI_WEBSITE_ID, so pages carry no analytics script.");
    return lines.join("\n");
  }
  const rows: Array<[FileWeight | undefined, number]> = [
    [report.tracker, TRACKER_MAX_GZIP_BYTES],
    [report.events, EVENTS_MAX_GZIP_BYTES],
  ];
  for (const [file, max] of rows) {
    if (!file) continue;
    lines.push(
      `  ${file.gzip <= max ? "✓" : "✗"} ${posix.basename(file.path)}  ${fmt(file.gzip)} of ${fmt(max)}, deferred, on ${report.pages} pages`,
    );
  }
  return lines.join("\n");
}
