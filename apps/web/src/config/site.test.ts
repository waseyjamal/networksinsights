import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { homeTitle, pageTitle, site, sitePages, staticPagePaths } from "./site";

const pagesDir = join(import.meta.dirname, "..", "pages");

describe("site config", () => {
  it("names the site and its domain", () => {
    expect(site.name).toBe("NetworksInsights");
    expect(site.domain).toBe("networksinsights.com");
    expect(site.url).toBe(`https://${site.domain}`);
    expect(site.tagline).toBe("Free online tools");
  });

  it("has a boolean launch flag", () => {
    expect(typeof site.launched).toBe("boolean");
  });

  it("formats page titles as '<Page> | NetworksInsights'", () => {
    expect(pageTitle("About")).toBe("About | NetworksInsights");
    expect(homeTitle).toBe("NetworksInsights — Free online tools");
  });
});

describe("static page paths", () => {
  // Every page file that is not generated from a config must be reserved, so a category slug or a
  // tool id can never take over its URL (ADR 0030).
  const files = readdirSync(pagesDir)
    .filter((name) => name.endsWith(".astro") && name !== "index.astro" && !name.startsWith("["))
    .map((name) => name.replace(/\.astro$/, ""))
    .sort();

  it("lists exactly the static page files in src/pages", () => {
    expect([...staticPagePaths].sort()).toEqual(files);
  });

  it("has no duplicates", () => {
    expect(new Set(staticPagePaths).size).toBe(staticPagePaths.length);
  });
});

describe("site pages", () => {
  it("link to reserved paths, with a trailing slash", () => {
    for (const page of Object.values(sitePages)) {
      expect(page.href).toMatch(/^\/[a-z-]+\/$/);
      expect(staticPagePaths).toContain(page.href.slice(1, -1));
    }
  });
});
