import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkSearchLoader,
  formatSearchLoaderReport,
  LOADER_MAX_GZIP_BYTES,
} from "./lib/search-loader";
import { scratchRoot } from "./lib/test-support";

// The search loader budget (ADR 0046), against small built sites written to disk. Each has the
// shape of the real output: pages with the dialog, one deferred loader that reaches the search
// module through import(), and the inline theme script.

const roots: Array<ReturnType<typeof scratchRoot>> = [];
afterEach(() => {
  for (const scratch of roots.splice(0)) scratch.remove();
});

const noise = (bytes: number) => randomBytes(bytes).toString("base64");

interface Site {
  loaderExtra?: string;
  loaderBytes?: number;
  pageExtra?: string;
  head?: string;
  /** A file that imports the search module statically. */
  staticImporter?: boolean;
  inlineScripts?: number;
  home?: boolean;
  dialog?: boolean;
  island?: boolean;
}

function build(site: Site = {}) {
  const scratch = scratchRoot();
  roots.push(scratch);
  const dist = join(scratch.root, "dist");
  const put = (path: string, content: string) => {
    mkdirSync(dirname(join(dist, path)), { recursive: true });
    writeFileSync(join(dist, path), content);
  };
  put("_astro/search-ui.AAA.js", `export const open=()=>1;${noise(2000)}`);
  put(
    "_astro/Loader.BBB.js",
    `${site.loaderExtra ?? ""}var l=()=>import("./search-ui.AAA.js");document.addEventListener("click",l);${noise(site.loaderBytes ?? 300)}`,
  );
  if (site.staticImporter)
    put("_astro/other.CCC.js", `import{open}from"./search-ui.AAA.js";open();`);
  if (site.pageExtra) put("_astro/extra.DDD.js", "export default 1;");
  const inline = Array.from(
    { length: site.inlineScripts ?? 1 },
    () => "<script>localStorage.getItem('ni-theme')</script>",
  ).join("");
  const html = `<!doctype html><html><head>${inline}${site.head ?? ""}</head><body>${
    site.island ? '<astro-island uid="x"></astro-island>' : ""
  }${site.dialog === false ? "" : "<dialog data-ni-search></dialog>"}<script type="module" src="/_astro/Loader.BBB.js"></script>${site.pageExtra ?? ""}</body></html>`;
  put("about/index.html", html);
  if (site.home !== false) put("index.html", html);
  return dist;
}

const problems = (site: Site) => checkSearchLoader(build(site)).violations.map((v) => v.problem);

describe("a build that follows the rule", () => {
  it("passes: one small loader per page, the module only through import()", () => {
    const report = checkSearchLoader(build());
    expect(report.violations).toEqual([]);
    expect(report.measured).toBe(true);
    expect(report.pages).toBe(2);
    expect(report.loaders).toHaveLength(1);
    expect(report.loaders[0]?.gzip).toBeLessThan(LOADER_MAX_GZIP_BYTES);
    expect(report.module?.path).toBe("_astro/search-ui.AAA.js");
  });

  it("prints the loader and the module, and says search stays out of the page", () => {
    const text = formatSearchLoaderReport(checkSearchLoader(build()));
    expect(text).toContain("Search loader");
    expect(text).toContain("Loader.BBB.js");
    expect(text).toContain("loaded only after intent");
    expect(text).toContain("until a visitor shows intent");
  });

  it("allows a page with an island to carry Astro's own scripts as well", () => {
    expect(
      problems({
        island: true,
        pageExtra: '<script type="module" src="/_astro/extra.DDD.js"></script>',
        inlineScripts: 2,
      }),
    ).toEqual([]);
  });

  it("does not count structured data as a script", () => {
    expect(
      problems({ head: '<script type="application/ld+json">{"@type":"WebPage"}</script>' }),
    ).toEqual([]);
  });
});

describe("a build that breaks it", () => {
  it("fails a loader over 2 KB gzip, naming the file, the size and the limit", () => {
    const report = checkSearchLoader(build({ loaderBytes: 4000 }));
    const [first] = report.violations;
    expect(report.violations).toHaveLength(1);
    expect(first?.problem).toMatch(/search loader is \d+ B gzip; the limit is 2048 B/);
    expect(first?.dir).toBe("_astro/Loader.BBB.js");
  });

  it("fails a loader that imports the search module statically, so it would load with the page", () => {
    const report = checkSearchLoader(
      build({ loaderExtra: 'import{open}from"./search-ui.AAA.js";' }),
    );
    const found = report.violations.map((v) => v.problem);
    expect(found.some((text) => text.includes("imports the search module statically"))).toBe(true);
    expect(found.some((text) => text.includes("search loader imports"))).toBe(true);
  });

  it("fails any file that imports the search module statically", () => {
    const found = problems({ staticImporter: true });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("imports the search module statically");
  });

  it("fails an extra script on a page with no island", () => {
    const found = problems({
      pageExtra: '<script type="module" src="/_astro/extra.DDD.js"></script>',
    });
    expect(found.some((text) => text.includes("has no island"))).toBe(true);
  });

  it("fails a second inline script on a page with no island", () => {
    const found = problems({ inlineScripts: 2 });
    expect(found.filter((text) => text.includes("2 inline scripts")).length).toBeGreaterThan(0);
  });

  it("fails a preload or prefetch of the search module or the index", () => {
    for (const head of [
      '<link rel="modulepreload" href="/_astro/search-ui.AAA.js">',
      '<link rel="preload" href="/_astro/search-ui.AAA.js" as="script">',
      '<link rel="prefetch" href="/search-index.0123456789ab.json">',
    ]) {
      expect(
        problems({ head }).some((text) => text.includes("preloads search")),
        head,
      ).toBe(true);
    }
  });

  it("fails a build whose pages have the dialog but which has no search module", () => {
    const dist = build();
    rmSync(join(dist, "_astro", "search-ui.AAA.js"));
    const found = checkSearchLoader(dist).violations.map((v) => v.problem);
    expect(found).toEqual(["the build has no search module (_astro/search-ui.<hash>.js)"]);
  });

  it("fails a home page that lost the dialog, instead of skipping the check", () => {
    const found = problems({ dialog: false });
    expect(found).toEqual(["the built home page has no search dialog"]);
  });
});

describe("a build with nothing to measure", () => {
  it("passes when there is no build output, and says so", () => {
    const scratch = scratchRoot();
    roots.push(scratch);
    const report = checkSearchLoader(join(scratch.root, "dist"));
    expect(report.measured).toBe(false);
    expect(report.violations).toEqual([]);
    expect(formatSearchLoaderReport(report)).toContain("nothing to measure");
  });

  it("passes when the build has pages but none with the dialog and no home page", () => {
    const dist = build({ dialog: false, home: false });
    const report = checkSearchLoader(dist);
    expect(report.measured).toBe(false);
    expect(report.violations).toEqual([]);
  });
});
