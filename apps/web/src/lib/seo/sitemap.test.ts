import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { categories, categoriesUpdated, categoryHref } from "../../config/categories";
import { pageUpdated, staticPagePaths } from "../../config/site";
import {
  buildSitemapFiles,
  indexablePages,
  isCategoryIndexable,
  newest,
  readSitemapIndex,
  readUrlset,
  renderSitemapIndex,
  renderUrlset,
  SITEMAP_URL_LIMIT,
  sitemapsExist,
} from "./sitemap";
import { manyTools, toolOf } from "./test-tools";

const ids = categories.map((category) => category.id);

describe("which pages are in the sitemaps", () => {
  const tools = [toolOf("word-counter", "text", "2026-09-19"), toolOf("case-converter", "text")];
  const groups = indexablePages(tools);
  const everything = [...groups.pages, ...groups.categories, ...groups.tools];

  it("holds the site pages, the categories that have a tool, and every tool", () => {
    expect(groups.pages.map((page) => page.path)).toEqual([
      "/",
      "/tools/",
      "/about/",
      "/contact/",
      "/privacy/",
      "/terms/",
    ]);
    expect(groups.categories.map((page) => page.path)).toEqual(["/text-tools/"]);
    expect(groups.tools.map((page) => page.path)).toEqual(["/case-converter/", "/word-counter/"]);
  });

  it("never holds the 404 page or the design system", () => {
    const paths = everything.map((page) => page.path);
    expect(paths).not.toContain("/404/");
    expect(paths).not.toContain("/design-system/");
    expect(paths.some((path) => path.includes("404") || path.includes("design"))).toBe(false);
  });

  it("uses an absolute URL on the production domain, with a trailing slash, for every entry", () => {
    for (const page of everything) {
      expect(page.loc).toBe(`https://networksinsights.com${page.path}`);
      expect(page.loc.endsWith("/")).toBe(true);
    }
  });

  it("never lists a URL twice", () => {
    const locs = everything.map((page) => page.loc);
    expect(new Set(locs).size).toBe(locs.length);
  });

  it("holds every static page file the site has, except the two that are not indexable", () => {
    const listed = groups.pages.map((page) => page.path.replaceAll("/", ""));
    const expected = staticPagePaths.filter((path) => path !== "404" && path !== "design-system");
    expect([...listed.filter(Boolean)].sort()).toEqual([...expected].sort());
  });
});

describe("a category with no tool", () => {
  it("is indexable only once it has a tool", () => {
    expect(isCategoryIndexable(0)).toBe(false);
    expect(isCategoryIndexable(1)).toBe(true);
    expect(isCategoryIndexable(40)).toBe(true);
  });

  it("is left out of the sitemap, and comes in with its first tool", () => {
    expect(indexablePages([]).categories).toEqual([]);
    expect(
      indexablePages([toolOf("merge-pdf", "pdf")]).categories.map((page) => page.path),
    ).toEqual([
      categoryHref(categories.find((category) => category.id === "pdf") ?? categories[0]),
    ]);
  });
});

describe("lastmod comes from real data", () => {
  it("is the tool's own `updated` date for a tool", () => {
    const groups = indexablePages([toolOf("word-counter", "text", "2026-09-15")]);
    expect(groups.tools[0]?.lastmod).toBe("2026-09-15");
  });

  it("is the newest tool date for a category, but never before the category wording's date", () => {
    const older = indexablePages([toolOf("a-tool", "text", "2026-01-01")]);
    expect(older.categories[0]?.lastmod).toBe(categoriesUpdated);
    const newer = indexablePages([
      toolOf("a-tool", "text", "2099-01-01"),
      toolOf("b-tool", "text", "2098-01-01"),
    ]);
    expect(newer.categories[0]?.lastmod).toBe("2099-01-01");
  });

  it("is the newest of the page's own date and every tool's date for the home page and /tools/", () => {
    const empty = indexablePages([]);
    expect(empty.pages[0]?.lastmod).toBe(pageUpdated.home);
    expect(empty.pages[1]?.lastmod).toBe(pageUpdated.tools);
    const later = indexablePages([toolOf("a-tool", "text", "2099-05-05")]);
    expect(later.pages[0]?.lastmod).toBe("2099-05-05");
    expect(later.pages[1]?.lastmod).toBe("2099-05-05");
    // A static page is not touched by a tool.
    expect(later.pages[2]?.lastmod).toBe(pageUpdated.about);
  });

  it("is a real ISO date, and never in the future, for every maintained date", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const date of [...Object.values(pageUpdated), categoriesUpdated]) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${date}T00:00:00Z`).toISOString().startsWith(date)).toBe(true);
      expect(date <= today, `${date} is in the future`).toBe(true);
    }
  });

  it("picks the newest of some dates", () => {
    expect(newest(["2026-01-02", "2026-03-01", "2025-12-31"])).toBe("2026-03-01");
    expect(() => newest([])).toThrow();
  });
});

describe("the maintained page dates are not stale", () => {
  // `pageUpdated` is kept by hand. On a full clone this fails if a page's file changed in git after
  // its date, so a page whose wording changed cannot keep an old `lastmod`. A shallow clone (CI)
  // dates every file the same, so there the check is skipped: a full clone runs it before every push.
  const web = join(import.meta.dirname, "..", "..", "..");
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: web,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  let shallow = true;
  try {
    shallow = git("rev-parse", "--is-shallow-repository") !== "false";
  } catch {
    shallow = true;
  }

  const files = {
    about: "src/pages/about.astro",
    contact: "src/pages/contact.astro",
    privacy: "src/pages/privacy.astro",
    terms: "src/pages/terms.astro",
  } as const;

  it.skipIf(shallow)("has each static page's date on or after its last change in git", () => {
    for (const [page, file] of Object.entries(files)) {
      expect(existsSync(join(web, file)), file).toBe(true);
      const changed = git("log", "-1", "--format=%cs", "--", file);
      if (changed === "") continue; // not committed yet
      expect(
        pageUpdated[page as keyof typeof files] >= changed,
        `${file} changed on ${changed} but its date in config/site.ts is ${pageUpdated[page as keyof typeof files]}: change the date when you change what the page says`,
      ).toBe(true);
    }
  });
});

describe("splitting at the protocol's limit", () => {
  it("puts up to 50,000 URLs in one file and the rest in the next", () => {
    expect(SITEMAP_URL_LIMIT).toBe(50_000);
    const files = buildSitemapFiles(manyTools(120, ids), 50);
    const toolFiles = files.filter((file) => file.slug.startsWith("tools"));
    expect(toolFiles.map((file) => file.slug)).toEqual(["tools", "tools-2", "tools-3"]);
    expect(toolFiles.map((file) => file.entries.length)).toEqual([50, 50, 20]);
  });

  it("gives every file a group name, and no file to a group with nothing in it", () => {
    expect(buildSitemapFiles([]).map((file) => file.slug)).toEqual(["pages"]);
    expect(buildSitemapFiles([toolOf("word-counter")]).map((file) => file.slug)).toEqual([
      "pages",
      "categories",
      "tools",
    ]);
  });

  it("stays well under the size limit at 1,000 tools, and is one file", () => {
    const files = buildSitemapFiles(manyTools(1000, ids));
    const tools = files.filter((file) => file.slug.startsWith("tools"));
    expect(tools).toHaveLength(1);
    expect(Buffer.byteLength(renderUrlset(tools[0]?.entries ?? []))).toBeLessThan(50 * 1024 * 1024);
  });
});

describe("the XML", () => {
  const files = buildSitemapFiles([toolOf("word-counter", "text", "2026-09-19")]);

  it("writes a urlset with a loc and a lastmod for each URL, and no priority or changefreq", () => {
    const xml = renderUrlset(files[0]?.entries ?? []);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).not.toContain("<priority>");
    expect(xml).not.toContain("<changefreq>");
    const urls = readUrlset(xml);
    expect(urls).toHaveLength(files[0]?.entries.length ?? -1);
    for (const url of urls) {
      expect(url.loc).toMatch(
        /^https:\/\/networksinsights\.com\/.*\/$|^https:\/\/networksinsights\.com\/$/,
      );
      expect(url.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("writes an index that lists every file with the newest lastmod inside it", () => {
    const xml = renderSitemapIndex(files);
    expect(readSitemapIndex(xml)).toEqual([
      "https://networksinsights.com/sitemap-pages.xml",
      "https://networksinsights.com/sitemap-categories.xml",
      "https://networksinsights.com/sitemap-tools.xml",
    ]);
    expect(xml).toContain("<lastmod>2026-09-19</lastmod>");
  });

  it("escapes what XML needs escaped", () => {
    const xml = renderUrlset([
      { path: "/x/", loc: "https://networksinsights.com/?a=1&b=<2>", lastmod: "2026-09-19" },
    ]);
    expect(xml).toContain("a=1&amp;b=&lt;2&gt;");
    expect(readUrlset(xml)[0]?.loc).toBe("https://networksinsights.com/?a=1&b=<2>");
  });
});

describe("before launch", () => {
  it("has no sitemap at all, because every page is noindex", () => {
    expect(sitemapsExist(false)).toBe(false);
    expect(sitemapsExist(true)).toBe(true);
  });
});
