import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";
import { site } from "../config/site";
import Base from "./Base.astro";

const title = "Test Title | NetworksInsights";
const description = "A test description for the SEO basics.";

// Finds <meta name="..."> and returns its content, whatever the attribute order.
function metaContent(html: string, name: string): string | undefined {
  const tag = html.match(new RegExp(`<meta[^>]*name="${name}"[^>]*>`))?.[0];
  return tag?.match(/content="([^"]*)"/)?.[1];
}

describe("Base layout SEO basics", () => {
  let html = "";

  beforeAll(async () => {
    const container = await AstroContainer.create();
    html = await container.renderToString(Base, {
      props: { title, description },
      slots: { default: "<main>content</main>" },
    });
  });

  it('sets <html lang="en">', () => {
    expect(html).toMatch(/<html[^>]*\slang="en"/);
  });

  it("declares a charset meta", () => {
    expect(html).toMatch(/<meta[^>]*\scharset="utf-8"/i);
  });

  it("declares the viewport meta", () => {
    expect(metaContent(html, "viewport")).toBe("width=device-width, initial-scale=1");
  });

  it("renders the title prop inside <title>", () => {
    expect(html).toContain(`<title>${title}</title>`);
  });

  it("renders the description prop in the description meta", () => {
    expect(metaContent(html, "description")).toBe(description);
  });

  // Launch day flips site.launched (ADR 0029) and this test stops applying; robots.test.ts covers
  // both values of the flag. Until then it must hold for every page, even one that does not ask.
  it.runIf(!site.launched)("renders noindex, nofollow on every page before launch", async () => {
    expect(metaContent(html, "robots")).toBe("noindex, nofollow");
    const container = await AstroContainer.create();
    const noindexHtml = await container.renderToString(Base, {
      props: { title, description, noindex: true },
      slots: { default: "<main>content</main>" },
    });
    expect(metaContent(noindexHtml, "robots")).toBe("noindex, nofollow");
  });

  // Before launch every page has one; after it an indexable page has none (robots.test.ts).
  it("renders at most one robots meta", () => {
    expect(html.match(/<meta[^>]*name="robots"/g) ?? []).toHaveLength(site.launched ? 0 : 1);
  });
});

describe("Base layout theming", () => {
  let html = "";

  beforeAll(async () => {
    const container = await AstroContainer.create();
    html = await container.renderToString(Base, {
      props: { title, description },
      slots: { default: "<main>content</main>" },
    });
  });

  // The theme script is the only inline script and must be static (Mission 12 hashes it for CSP).
  const inlineScripts = () => [
    ...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g),
  ];

  it('defaults <html> to data-theme="system", so pages work without JavaScript', () => {
    expect(html).toMatch(/<html[^>]*\sdata-theme="system"/);
  });

  it("declares the color-scheme meta for light and dark", () => {
    expect(metaContent(html, "color-scheme")).toBe("light dark");
  });

  it("declares a theme-color meta for each scheme, with hex colors from the tokens", () => {
    const tags = [...html.matchAll(/<meta[^>]*name="theme-color"[^>]*>/g)].map((m) => m[0]);
    expect(tags).toHaveLength(2);
    const light = tags.find((t) => t.includes("prefers-color-scheme: light"));
    const dark = tags.find((t) => t.includes("prefers-color-scheme: dark"));
    expect(light).toMatch(/content="#[0-9a-f]{6}"/);
    expect(dark).toMatch(/content="#[0-9a-f]{6}"/);
    expect(light).not.toBe(dark);
    // The dark chrome color is a deep navy, never pure black.
    expect(dark).not.toContain("#000000");
  });

  it("renders the theme script inline in <head>, before the stylesheet and the body", () => {
    const scripts = inlineScripts();
    expect(scripts).toHaveLength(1);
    const script = scripts[0]?.[0] ?? "";
    expect(script).toContain("localStorage");
    expect(script).toContain('"ni-theme"');
    expect(script).toContain("data-theme");
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain(script);
  });

  it("keeps the theme script small and free of interpolated values", () => {
    const script = inlineScripts()[0]?.[1] ?? "";
    expect(script.length).toBeLessThan(2500);
    expect(script).not.toMatch(/\$\{[^}]*Astro/);
  });

  it("places the theme script after the theme-color metas it updates", () => {
    expect(html.lastIndexOf('<meta name="theme-color"')).toBeLessThan(html.indexOf("<script"));
  });
});
