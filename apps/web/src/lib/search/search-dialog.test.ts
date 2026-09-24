import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";
import SearchDialog from "../../components/ui/SearchDialog.astro";
import { categories, categoryHref } from "../../config/categories";
import { siteSearchIndex } from "./site-index";

// The markup of the dialog, which is complete before any script runs, and the source rules that
// keep the search module safe and out of the initial page.

const sources = import.meta.glob(
  ["./*.ts", "../../components/ui/SearchDialog.astro", "../../components/ui/ToolFilter.astro"],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;
const source = (path: string) => {
  const text = sources[path];
  if (text === undefined) throw new Error(`no source at ${path}`);
  return text;
};

let html = "";
beforeAll(async () => {
  const container = await AstroContainer.create();
  html = await container.renderToString(SearchDialog);
});

describe("the dialog markup", () => {
  it("is a native <dialog> that is shut, named, and carries the address of the index", () => {
    const tag = /<dialog[^>]*>/.exec(html)?.[0] ?? "";
    expect(tag).toContain('aria-label="Search tools"');
    expect(tag).not.toMatch(/\sopen[\s>=]/);
    expect(tag).toContain(`data-index="${siteSearchIndex.href}"`);
  });

  it("has a combobox that controls a listbox, per the WAI-ARIA pattern", () => {
    const input = /<input[^>]*role="combobox"[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).toContain('aria-controls="ni-search-results"');
    expect(input).toContain('aria-autocomplete="list"');
    expect(input).toContain('aria-expanded="false"');
    expect(input).toContain('aria-label="Search tools"');
    const listbox = /<div[^>]*role="listbox"[^>]*>/.exec(html)?.[0] ?? "";
    expect(listbox).toContain('id="ni-search-results"');
    expect(listbox).toContain("hidden");
  });

  it("has a polite live region for the result count, and a close button", () => {
    expect(html).toMatch(/<p[^>]*role="status"[^>]*aria-live="polite"[^>]*data-ni-search-live/);
    expect(html).toMatch(/<button[^>]*aria-label="Close search"[^>]*data-ni-search-close/);
  });

  it("links every category, each with its accent hook, and links to all tools", () => {
    for (const category of categories) {
      expect(html).toMatch(
        new RegExp(`<a[^>]*href="${categoryHref(category)}"[^>]*data-cat="${category.id}"`),
      );
    }
    expect(html).toMatch(/<nav[^>]*aria-label="Browse by category"/);
    expect(html).toMatch(/<a[^>]*class="ni-search__all"[^>]*href="\/tools\/"/);
  });

  it("has the three honest messages, all hidden until the script needs one", () => {
    expect(html).toMatch(/data-ni-search-empty hidden/);
    expect(html).toMatch(/data-ni-search-none hidden/);
    expect(html).toMatch(/data-ni-search-error hidden/);
    expect(html).toContain("No tools yet");
    expect(html).toContain("Search could not load");
    expect(html).toContain("No tools match");
  });

  it("claims no count, rating or tool name", () => {
    const text = html.replace(/<script[\s\S]*?<\/script>|<[^>]*>/g, " ");
    expect(text).not.toMatch(/\d+\s+tools?\b/i);
    expect(text).not.toMatch(/\b(?:rated|reviews?|stars?)\b/i);
  });
});

describe("the search module never parses markup", () => {
  it("has no innerHTML, outerHTML, insertAdjacentHTML, document.write or DOMParser", () => {
    for (const file of ["./search-ui.ts", "./engine.ts", "./parse.ts", "./intent.ts"]) {
      const code = source(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code, file).not.toMatch(
        /innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment|\beval\(|new Function/,
      );
    }
  });

  it("builds text with textContent and text nodes", () => {
    expect(source("./search-ui.ts")).toContain("textContent");
    expect(source("./search-ui.ts")).toContain("createTextNode");
  });
});

describe("the loader", () => {
  const script = () => {
    const text = source("../../components/ui/SearchDialog.astro");
    return text.slice(text.lastIndexOf("<script>"));
  };

  it("imports the search module and the engine only with import(), never statically", () => {
    const staticImports = [...script().matchAll(/^\s*import\s[^(]*?from\s+"([^"]+)"/gm)].map(
      (match) => match[1],
    );
    expect(staticImports).toEqual(["../../lib/search/intent"]);
    expect(script()).toContain('import("../../lib/search/search-ui")');
  });

  it("is the only importer of the search module, and only lazily", () => {
    for (const [path, text] of Object.entries(sources)) {
      if (path === "./search-ui.ts") continue;
      const importers = [...text.matchAll(/(?:from|import\()\s*"([^"]*search-ui)"/g)];
      if (importers.length === 0) continue;
      expect(path).toBe("../../components/ui/SearchDialog.astro");
      expect(text).not.toMatch(/^\s*import\s[^(]*?from\s+"[^"]*search-ui"/m);
    }
  });

  it("listens for intent on the command bar and the filter, and for the shortcut keys", () => {
    const code = script();
    for (const type of ["pointerover", "focusin", "pointerdown", "click", "keydown"]) {
      expect(code, type).toContain(type);
    }
    expect(code).toContain("data-ni-search-trigger");
    expect(code).toContain("data-ni-filter-input");
  });

  it("falls back to the link's own address when the module cannot load", () => {
    expect(script()).toContain("location.assign(trigger.href)");
  });
});
