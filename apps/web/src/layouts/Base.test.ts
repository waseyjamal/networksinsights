import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";
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

  it("has no robots meta by default", () => {
    expect(metaContent(html, "robots")).toBeUndefined();
  });

  it("renders a noindex robots meta when noindex is set", async () => {
    const container = await AstroContainer.create();
    const noindexHtml = await container.renderToString(Base, {
      props: { title, description, noindex: true },
      slots: { default: "<main>content</main>" },
    });
    expect(metaContent(noindexHtml, "robots")).toBe("noindex");
  });
});
