import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkAnalytics,
  EVENTS_MAX_GZIP_BYTES,
  formatAnalyticsReport,
  isAnalyticsScript,
} from "./lib/analytics";
import { checkSearchLoader } from "./lib/search-loader";
import { scratchRoot } from "./lib/test-support";
import { repoRoot } from "./lib/tools";

// The analytics section of check:budgets (ADR 0051), against small built sites written to disk
// with the shape of the real output: the search loader, then the tracker and our events script.

const roots: Array<ReturnType<typeof scratchRoot>> = [];
afterEach(() => {
  for (const scratch of roots.splice(0)) scratch.remove();
});

const reviewedTracker = readFileSync(
  join(repoRoot, "apps", "web", "src", "lib", "analytics", "umami-tracker.js"),
);

const TRACKER_TAG =
  '<script defer src="/_astro/umami-tracker.EEE.js" data-website-id="x" data-domains="networksinsights.com"></script>';
const EVENTS_TAG =
  '<script type="module" src="/_astro/Analytics.astro_astro_type_script_index_0_lang.FFF.js"></script>';

interface Site {
  analytics?: boolean;
  trackerTag?: string;
  tracker?: Buffer | string;
  eventsBytes?: number;
  eventsExtra?: string;
  /** Leave the analytics scripts off the about page. */
  missingOnAbout?: boolean;
}

function build(site: Site = {}) {
  const scratch = scratchRoot();
  roots.push(scratch);
  const dist = join(scratch.root, "dist");
  const put = (path: string, content: string | Buffer) => {
    mkdirSync(dirname(join(dist, path)), { recursive: true });
    writeFileSync(join(dist, path), content);
  };
  put("_astro/search-ui.AAA.js", "export const open=()=>1;");
  put("_astro/Loader.BBB.js", 'var l=()=>import("./search-ui.AAA.js");');
  put("_astro/umami-tracker.EEE.js", site.tracker ?? reviewedTracker);
  put(
    "_astro/Analytics.astro_astro_type_script_index_0_lang.FFF.js",
    `${site.eventsExtra ?? ""}addEventListener("error",()=>1);${randomBytes(site.eventsBytes ?? 200).toString("base64")}`,
  );
  const page = (analytics: boolean) =>
    `<!doctype html><html><head><script>localStorage.getItem('ni-theme')</script></head><body><dialog data-ni-search></dialog><script type="module" src="/_astro/Loader.BBB.js"></script>${
      analytics ? `${site.trackerTag ?? TRACKER_TAG}${EVENTS_TAG}` : ""
    }</body></html>`;
  const on = site.analytics !== false;
  put("index.html", page(on));
  put("about/index.html", page(on && !site.missingOnAbout));
  return dist;
}

const problems = (site: Site) => checkAnalytics(build(site)).violations.map((v) => v.problem);

describe("a build with analytics that follows the rules", () => {
  it("passes: the reviewed tracker and a small events script, once on every page", () => {
    const report = checkAnalytics(build());
    expect(report.violations).toEqual([]);
    expect(report.on).toBe(true);
    expect(report.pages).toBe(2);
    expect(report.tracker?.path).toBe("_astro/umami-tracker.EEE.js");
    expect(formatAnalyticsReport(report)).toMatch(
      /✓ umami-tracker\.EEE\.js {2}2\.\d KB of 3\.0 KB/,
    );
  });

  it("leaves both files to this check, so the search loader check still passes", () => {
    expect(checkSearchLoader(build()).violations).toEqual([]);
    expect(isAnalyticsScript("_astro/umami-tracker.EEE.js")).toBe(true);
    expect(isAnalyticsScript("_astro/Loader.BBB.js")).toBe(false);
  });
});

describe("a build without analytics", () => {
  it("is reported as off, with nothing to check", () => {
    const report = checkAnalytics(build({ analytics: false }));
    expect(report).toMatchObject({ on: false, violations: [] });
    expect(formatAnalyticsReport(report)).toContain("Off: this build has no UMAMI_WEBSITE_ID");
  });
});

describe("a build that breaks the rules", () => {
  it("fails a page that lacks the scripts", () => {
    expect(problems({ missingOnAbout: true })).toEqual([
      "has 0 tracker and 0 analytics scripts; every page has exactly one of each",
    ]);
  });

  it("fails a tracker that is not deferred, or is a module", () => {
    const plain = TRACKER_TAG.replace(" defer", "");
    expect(problems({ trackerTag: plain })).toContain(
      "loads the tracker without `defer`, or as a module",
    );
    const module = TRACKER_TAG.replace("<script defer", '<script defer type="module"');
    expect(problems({ trackerTag: module })).toContain(
      "loads the tracker without `defer`, or as a module",
    );
  });

  it("fails a tracker the build changed", () => {
    expect(problems({ tracker: `${reviewedTracker.toString("utf8")};` })).toEqual([
      "the built tracker is not the reviewed copy (its SHA-256 differs from TRACKER.sha256)",
    ]);
  });

  it("fails an events script over its budget, or one that imports a file", () => {
    expect(problems({ eventsBytes: 4000 })[0]).toMatch(
      new RegExp(`is \\d+ B gzip; the limit is ${EVENTS_MAX_GZIP_BYTES} B`),
    );
    expect(problems({ eventsExtra: 'import"./Loader.BBB.js";' })[0]).toContain(
      "imports _astro/Loader.BBB.js",
    );
  });
});
