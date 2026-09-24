import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { categories, categoryHref } from "../../config/categories";
import { toolOf } from "../seo/test-tools";
import { type FixtureGroup, filterFixtureHtml } from "./filter-fixture";

// The /tools/ page reads the registry, and the real one has no tools yet (Mission 13). This file
// gives it three, so the page that has a list to filter can be checked.
vi.mock("../registry", async () => {
  const tools = [
    toolOf("merge-pdf", "pdf"),
    toolOf("split-pdf", "pdf"),
    toolOf("word-counter", "text"),
  ];
  return {
    tools,
    getTool: (id: string) => tools.find((tool) => tool.manifest.id === id),
    toolsInCategory: (id: string) => tools.filter((tool) => tool.manifest.category === id),
    toolCount: (id: string) => tools.filter((tool) => tool.manifest.category === id).length,
  };
});

const { default: ToolsPage } = await import("../../pages/tools.astro");

let container: AstroContainer;
let html = "";
beforeAll(async () => {
  container = await AstroContainer.create();
  html = await container.renderToString(ToolsPage, {
    request: new Request("https://networksinsights.com/tools/"),
  });
});

/** The filter hooks the script reads: every data-ni-filter* attribute name a markup uses. */
const hooks = (markup: string) =>
  [...new Set([...markup.matchAll(/\bdata-ni-filter[\w-]*/g)].map((match) => match[0]))].sort();

describe("the /tools/ page with tools", () => {
  it("lists every tool as a plain link, in the HTML, filter or no filter", () => {
    for (const id of ["merge-pdf", "split-pdf", "word-counter"]) {
      expect(html).toContain(`<a href="/${id}/">`);
    }
  });

  it("has the filter, labelled, with the hooks the script needs", () => {
    expect(html).toContain("data-ni-filter");
    expect(html).toMatch(/<label[^>]*for="tool-filter"[^>]*>\s*Filter tools\s*<\/label>/);
    expect(html).toMatch(/<input[^>]*id="tool-filter"[^>]*type="search"/);
    expect(html).toMatch(/<p[^>]*role="status"[^>]*aria-live="polite"[^>]*data-ni-filter-status/);
  });

  it("marks the list and one group per category that has tools", () => {
    expect(html.match(/data-ni-filter-list/g)).toHaveLength(1);
    expect(html.match(/data-ni-filter-group/g)).toHaveLength(2);
  });

  it("uses the same hooks as the fixture the browser tests splice into the built page", () => {
    const groups: FixtureGroup[] = ["pdf", "text"].map((id) => {
      const category = categories.find((item) => item.id === id);
      if (!category) throw new Error(`no category ${id}`);
      return {
        id,
        name: category.name,
        href: categoryHref(category),
        tools: [],
      };
    });
    expect(hooks(filterFixtureHtml(groups))).toEqual(hooks(html));
  });

  it("has a list item with a link for each tool, which is how the script finds its row", () => {
    const fixture = filterFixtureHtml([
      {
        id: "pdf",
        name: "PDF tools",
        href: "/pdf-tools/",
        tools: [{ name: "Merge Pdf", href: "/merge-pdf/" }],
      },
    ]);
    expect(fixture).toContain('<li><a href="/merge-pdf/">Merge Pdf</a></li>');
    expect(html).toMatch(/<li>\s*<a href="\/merge-pdf\/">\s*Merge Pdf\s*<\/a>\s*<\/li>/);
  });
});
