import { describe, expect, it } from "vitest";

// The zero-JavaScript rule of the listing pages, checked in the source rather than after the fact.
//
// The home page, /tools/ and the category pages read the registry for names and counts. If any of
// them could reach a tool's ui.tsx, island.astro or MDX, Astro would put an island on a page that
// needs none. Two things keep that from happening, and this file fails if either stops being true:
//
//   1. The registry modules a listing page imports hold metadata only.
//   2. The two modules that do load tool UI are imported by the tool route alone.
//
// Since Mission 11 every page also carries one deferred script, the search loader, and nothing else
// (ADR 0046). It comes from SearchDialog.astro, which layouts/Base.astro renders once for every
// page. That is what the last block below pins down; search-dialog.test.ts checks the loader's own
// source, scripts/search-loader.test.ts its built size, and budgets.spec.ts measures the built
// pages in three real browsers.

const sources = import.meta.glob(
  ["./*.ts", "../../pages/*.astro", "../../components/**/*.astro", "../../layouts/*.astro"],
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
) as Record<string, string>;

const source = (path: string) => {
  const text = sources[path];
  if (text === undefined) throw new Error(`no source at ${path}, and this test needs it`);
  return text;
};

/** The modules that can pull a tool's UI into a page. */
const UI_LOADERS = ["./islands", "./content"];

const importsOf = (text: string) =>
  [...text.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

/** Each import.meta.glob() call in a file, as the text of the call. */
const globCalls = (text: string) => {
  const calls = text.split("import.meta.glob(").slice(1);
  return calls.map((call) => call.split("import.meta.glob(")[0] ?? "");
};

describe("the registry a listing page imports", () => {
  it("globs from one module only, so there is one place to check", () => {
    for (const file of ["./build.ts", "./entries.ts"]) {
      expect(globCalls(source(file)), file).toHaveLength(0);
    }
    expect(globCalls(source("./index.ts"))).toHaveLength(5);
  });

  it("reads every tool file as text, so none of them can become an island", () => {
    // ?raw is what makes island.astro and en.mdx strings rather than components: the contract
    // checks read them, the page never renders them. The manifests are plain metadata.
    for (const call of globCalls(source("./index.ts"))) {
      const isManifests = call.includes("tool.config.ts") && !call.includes("logic.ts");
      expect(isManifests || call.includes('query: "?raw"'), call.slice(0, 80)).toBe(true);
    }
  });

  for (const file of ["./index.ts", "./build.ts", "./entries.ts"]) {
    it(`${file} imports neither loader of tool UI`, () => {
      for (const loader of UI_LOADERS) {
        expect(importsOf(source(file)), file).not.toContain(loader);
      }
    });
  }
});

describe("the two modules that do load tool UI", () => {
  const pages = Object.entries(sources).filter(([path]) => path.startsWith("../../pages/"));

  it("are imported by the tool route and by nothing else", () => {
    const importers = pages
      .filter(([, text]) =>
        UI_LOADERS.some((loader) => text.includes(`registry/${loader.replace("./", "")}`)),
      )
      .map(([path]) => path);
    expect(importers).toEqual(["../../pages/[slug].astro"]);
  });

  it("is not imported by any component either, so a card can never mount a tool", () => {
    for (const [path, text] of Object.entries(sources)) {
      if (path.startsWith("../../components/")) {
        expect(text, path).not.toContain("registry/islands");
        expect(text, path).not.toContain("registry/content");
      }
    }
  });

  it("keeps the tool route's loads lazy, so a category page never runs them", () => {
    const route = source("../../pages/[slug].astro");
    // Both loads sit behind `tool ?`: a category page has no tool and never calls them.
    expect(route).toContain("const view = tool ? await viewOf(tool) : undefined;");
    for (const glob of [source("./islands.ts"), source("./content.ts")]) {
      expect(glob).not.toContain("eager: true");
    }
  });
});

describe("the pages that list tools", () => {
  for (const page of ["../../pages/index.astro", "../../pages/tools.astro"]) {
    it(`${page} uses the registry for counts and names only`, () => {
      const text = source(page);
      expect(importsOf(text).filter((specifier) => specifier.includes("registry"))).toEqual([
        "../lib/registry",
      ]);
      expect(text).not.toContain("client:");
    });
  }

  it("the category branch of the tool route ships no island of its own", () => {
    const route = source("../../pages/[slug].astro");
    const category = route.slice(route.indexOf("category && ("));
    expect(category).not.toContain("client:");
    expect(category).not.toContain("Island");
  });
});

describe("the one script every page carries: the search loader (ADR 0046)", () => {
  it("comes from SearchDialog, which the base layout renders once and no page renders itself", () => {
    const base = source("../../layouts/Base.astro");
    expect(base.match(/<SearchDialog\s*\/>/g)).toHaveLength(1);
    expect(importsOf(base)).toContain("../components/ui/SearchDialog.astro");

    for (const [path, text] of Object.entries(sources)) {
      if (path === "../../layouts/Base.astro") continue;
      expect(importsOf(text).join(" "), path).not.toContain("SearchDialog");
    }
  });

  it("gives a listing page no island of its own for it: the loader is a plain script", () => {
    const dialog = source("../../components/ui/SearchDialog.astro");
    expect(dialog).not.toMatch(/client:(?:load|idle|visible|media|only)/);
    expect(dialog).not.toContain("astro-island");
    expect(dialog).toContain("<script>");
  });

  it("keeps the registry out of the loader: the index is read by build code, never the browser", () => {
    const dialog = source("../../components/ui/SearchDialog.astro");
    const script = dialog.slice(dialog.lastIndexOf("<script>"));
    expect(script).not.toContain("registry");
    expect(script).not.toContain("engine");
  });
});
