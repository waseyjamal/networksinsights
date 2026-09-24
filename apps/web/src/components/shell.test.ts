import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";
import { categories } from "../config/categories";
import Page from "../layouts/Page.astro";
import Breadcrumbs from "./ui/Breadcrumbs.astro";
import CategoryTile from "./ui/CategoryTile.astro";
import CommandBar from "./ui/CommandBar.astro";

// The site shell: what every page is made of, and the "no fake content" rules of the components.

let container: Awaited<ReturnType<typeof AstroContainer.create>>;
beforeAll(async () => {
  container = await AstroContainer.create();
});

const tile = { category: "pdf", icon: "pdf", title: "PDF tools", description: "Merge.", href: "/" };

describe("CategoryTile", () => {
  it('says "Coming soon" and shows no number when it has no count', async () => {
    const html = await container.renderToString(CategoryTile, { props: tile });
    expect(html).toContain("Coming soon");
    expect(html).not.toMatch(/\d+\s+tools?/);
  });

  it('says "Coming soon" for a count of zero', async () => {
    const html = await container.renderToString(CategoryTile, { props: { ...tile, count: 0 } });
    expect(html).toContain("Coming soon");
  });

  it("shows a real count when there are tools", async () => {
    const many = await container.renderToString(CategoryTile, { props: { ...tile, count: 3 } });
    expect(many).toContain("3 tools");
    expect(many).not.toContain("Coming soon");
    const one = await container.renderToString(CategoryTile, { props: { ...tile, count: 1 } });
    expect(one).toContain("1 tool<");
  });
});

describe("CommandBar", () => {
  it("is a real link to /tools/ when it has an href, and the search trigger", async () => {
    const html = await container.renderToString(CommandBar, { props: { href: "/tools/" } });
    expect(html).toMatch(/<a[^>]*class="ni-commandbar"[^>]*href="\/tools\/"/);
    expect(html).toContain("data-ni-search-trigger");
    expect(html).toContain('aria-keyshortcuts="Control+K Meta+K /"');
    expect(html).not.toContain("<input");
  });

  it("marks the Ctrl+K hint as decoration that CSS shows only when the page has scripts", async () => {
    const html = await container.renderToString(CommandBar, { props: { href: "/tools/" } });
    const hint = /<span class="ni-commandbar__hint"([^>]*)>/.exec(html)?.[1] ?? "";
    expect(hint).toContain("data-js-only");
    expect(hint).toContain('aria-hidden="true"');
    // The link's accessible name is its label alone: the keys are not read out.
    expect(html).toContain("Search tools");
  });

  it("claims no tool count in its placeholder", async () => {
    const html = await container.renderToString(CommandBar, {});
    expect(html.match(/placeholder="([^"]*)"/)?.[1]).not.toMatch(/\d/);
  });
});

describe("Breadcrumbs", () => {
  it("links every item except the last, which is the current page", async () => {
    const html = await container.renderToString(Breadcrumbs, {
      props: { items: [{ label: "Home", href: "/" }, { label: "About" }] },
    });
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('<a href="/">Home</a>');
    expect(html).toMatch(/<span aria-current="page">About<\/span>/);
    expect(html.match(/<a /g)).toHaveLength(1);
  });
});

describe("Page layout", () => {
  let html = "";
  beforeAll(async () => {
    html = await container.renderToString(Page, {
      props: { title: "Test | NetworksInsights", description: "A test page." },
      slots: { default: "<h1>Test</h1>" },
    });
  });

  it("has a skip link, then the header, main and footer landmarks", () => {
    const skip = html.indexOf('class="ni-skip"');
    const header = html.indexOf("<header");
    const main = html.indexOf('<main id="main"');
    const footer = html.indexOf("<footer");
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(header);
    expect(header).toBeLessThan(main);
    expect(main).toBeLessThan(footer);
    expect(html).toContain('href="#main"');
    expect(html).toMatch(/<main[^>]*tabindex="-1"/);
  });

  it("gives every navigation landmark its own name", () => {
    const labels = [...html.matchAll(/<nav[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
    // The last one is inside the search dialog, which every page carries (shut).
    expect(labels).toEqual(["Main", "Menu", "Footer", "Browse by category"]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("links every category in the footer and the menu", () => {
    for (const category of categories) {
      const link = `href="/${category.slug}/"`;
      expect(html.split(link).length - 1, category.slug).toBeGreaterThanOrEqual(2);
    }
  });

  it("shows the tagline and the current year in the footer, with the footer pages", () => {
    const footer = html.slice(html.indexOf("<footer"));
    expect(footer).toContain(`© ${new Date().getFullYear()} NetworksInsights.`);
    expect(footer).toContain("Free online tools");
    for (const path of ["/tools/", "/about/", "/contact/", "/privacy/", "/terms/"]) {
      expect(footer).toContain(`href="${path}"`);
    }
  });

  it("does not link the design system", () => {
    expect(html).not.toContain("/design-system");
  });

  it("uses a native <details> menu, so it needs no JavaScript", () => {
    expect(html).toMatch(/<details class="ni-menu">\s*<summary/);
  });
});
