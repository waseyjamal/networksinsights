import { faqPairs, quickFacts, type ToolManifest } from "@networksinsights/tool-sdk";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import Content from "../../components/tool/fixture-content.astro";
import Island from "../../components/tool/fixture-island.astro";
import { FIXTURE_MDX } from "../../components/tool/fixture-mdx";
import ToolPage from "../../components/tool/ToolPage.astro";
import { categories, categoryById, categoryHref } from "../../config/categories";
import { site, sitePages } from "../../config/site";
import Category from "../../pages/[slug].astro";
import FourOhFour from "../../pages/404.astro";
import About from "../../pages/about.astro";
import Contact from "../../pages/contact.astro";
import Home from "../../pages/index.astro";
import Privacy from "../../pages/privacy.astro";
import Terms from "../../pages/terms.astro";
import Tools from "../../pages/tools.astro";
import type { Tool } from "../registry/build";
import { structuredDataProblems } from "./consistency";
import {
  canonicalLinks,
  jsonLdBlocks,
  metaName,
  metaProperty,
  openGraphTags,
  titleOf,
  twitterTags,
  visibleText,
} from "./html";
import { jsonLdDocumentSchema } from "./schemas";

const text = categoryById("text");
if (!text) throw new Error("the text category is missing");
const pdf = categories.find((category) => category.id === "pdf");
if (!pdf) throw new Error("the pdf category is missing");

const manifest: ToolManifest = {
  id: "word-counter",
  name: "Word counter",
  category: "text",
  summary: "Count the words, characters and lines in any text, as you type.",
  tags: ["words"],
  runtime: "client",
  status: "stable",
  input: z.object({ text: z.string() }),
  related: [],
  added: "2026-09-01",
  updated: "2026-09-20",
};
const tool: Tool = {
  manifest,
  dir: "tools/text/word-counter",
  href: "/word-counter/",
  faq: faqPairs(FIXTURE_MDX),
};

/** The hosts a page may be served from: production, a preview, a local server. */
const hosts = [
  "https://networksinsights.com",
  "https://pr-11-networksinsights.example.workers.dev",
  "http://127.0.0.1:4321",
];

interface Case {
  name: string;
  path: string;
  render: (container: AstroContainer, host: string) => Promise<string>;
  /** False for a page that opts out of indexing. */
  indexable: boolean;
  /** The JSON-LD node types the page must carry, in any order. */
  types: string[];
}

const at = (host: string, path: string) => new Request(`${host}${path}`);
let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

const cases: Case[] = [
  {
    name: "the home page",
    path: "/",
    render: (c, h) => c.renderToString(Home, { request: at(h, "/") }),
    indexable: true,
    types: ["Organization", "WebSite"],
  },
  {
    name: "/tools/",
    path: sitePages.tools.href,
    render: (c, h) => c.renderToString(Tools, { request: at(h, "/tools/") }),
    indexable: true,
    types: ["CollectionPage", "BreadcrumbList"],
  },
  ...[
    ["/about/", About],
    ["/contact/", Contact],
    ["/privacy/", Privacy],
    ["/terms/", Terms],
  ].map(
    ([path, page]): Case => ({
      name: `${String(path)}`,
      path: String(path),
      render: (c, h) => c.renderToString(page as typeof About, { request: at(h, String(path)) }),
      indexable: true,
      types: ["BreadcrumbList"],
    }),
  ),
  {
    name: "a tool page",
    path: "/word-counter/",
    render: (c, h) =>
      c.renderToString(ToolPage, {
        request: at(h, "/word-counter/"),
        props: { tool, category: text, related: [], Island, Content },
      }),
    indexable: true,
    types: ["WebApplication", "FAQPage", "BreadcrumbList"],
  },
  {
    name: "the 404 page",
    path: "/no-such-page/",
    render: (c, h) => c.renderToString(FourOhFour, { request: at(h, "/no-such-page/") }),
    indexable: false,
    types: [],
  },
];

describe.each(cases)("$name", (page) => {
  const rendered = new Map<string, string>();
  beforeAll(async () => {
    for (const host of hosts) rendered.set(host, await page.render(container, host));
  });
  const htmlAt = (host: string) => rendered.get(host) ?? "";

  if (page.indexable) {
    it("has one absolute canonical on the production domain, whatever host serves it", () => {
      for (const host of hosts) {
        expect(canonicalLinks(htmlAt(host)), host).toEqual([`${site.url}${page.path}`]);
      }
    });

    it("has a canonical that ends in a slash and has no query or fragment", () => {
      const [canonical = ""] = canonicalLinks(htmlAt(hosts[0] ?? ""));
      expect(canonical.endsWith("/")).toBe(true);
      expect(canonical).not.toMatch(/[?#]/);
      expect(new URL(canonical).origin).toBe(site.url);
    });

    it("gives og:url the same address as the canonical", () => {
      for (const host of hosts) {
        expect(metaProperty(htmlAt(host), "og:url"), host).toBe(`${site.url}${page.path}`);
      }
    });
  } else {
    it("has no canonical and no og:url, because it is not a page to index", () => {
      for (const host of hosts) {
        expect(canonicalLinks(htmlAt(host)), host).toEqual([]);
        expect(metaProperty(htmlAt(host), "og:url"), host).toBeUndefined();
      }
    });
  }

  it("has the Open Graph tags, saying what the title and description say", () => {
    const html = htmlAt(hosts[0] ?? "");
    const og = new Map(openGraphTags(html));
    for (const property of [
      "og:type",
      "og:site_name",
      "og:title",
      "og:description",
      "og:image",
      "og:image:width",
      "og:image:height",
      "og:image:alt",
    ]) {
      expect(og.get(property), property).toBeTruthy();
    }
    expect(og.get("og:title")).toBe(titleOf(html));
    expect(og.get("og:description")).toBe(metaName(html, "description"));
    expect(og.get("og:image:width")).toBe("1200");
    expect(og.get("og:image:height")).toBe("630");
    expect(og.get("og:image")).toMatch(/^https:\/\/networksinsights\.com\/og\/[a-z0-9-]+\.png$/);
  });

  it("has the Twitter/X card, repeating the Open Graph words and image", () => {
    const html = htmlAt(hosts[0] ?? "");
    const tw = new Map(twitterTags(html));
    const og = new Map(openGraphTags(html));
    expect(tw.get("twitter:card")).toBe("summary_large_image");
    expect(tw.get("twitter:title")).toBe(og.get("og:title"));
    expect(tw.get("twitter:description")).toBe(og.get("og:description"));
    expect(tw.get("twitter:image")).toBe(og.get("og:image"));
    expect(tw.get("twitter:image:alt")).toBe(og.get("og:image:alt"));
  });

  it("names the same share image whatever host serves it", () => {
    const images = hosts.map((host) => metaProperty(htmlAt(host), "og:image"));
    expect(new Set(images).size).toBe(1);
  });

  if (page.types.length > 0) {
    it("carries the structured data for what it is, and only that", () => {
      const blocks = jsonLdBlocks(htmlAt(hosts[0] ?? ""));
      expect(blocks).toHaveLength(1);
      const document = jsonLdDocumentSchema.parse(blocks[0]);
      expect(document["@graph"].map((node) => node["@type"]).sort()).toEqual(
        [...page.types].sort(),
      );
    });

    it("says nothing in its structured data that the page does not show", () => {
      for (const host of hosts) expect(structuredDataProblems(htmlAt(host)), host).toEqual([]);
    });
  } else {
    it("carries no structured data", () => {
      expect(jsonLdBlocks(htmlAt(hosts[0] ?? ""))).toEqual([]);
    });
  }
});

describe("the tool page", () => {
  let html = "";
  beforeAll(async () => {
    html = await container.renderToString(ToolPage, {
      request: at(hosts[0] ?? "", "/word-counter/"),
      props: { tool, category: text, related: [], Island, Content },
    });
  });

  it("uses the tool's own share image", () => {
    expect(metaProperty(html, "og:image")).toBe("https://networksinsights.com/og/word-counter.png");
  });

  it("is a free web application in the category of the tool", () => {
    const document = jsonLdDocumentSchema.parse(jsonLdBlocks(html)[0]);
    const app = document["@graph"].find((node) => node["@type"] === "WebApplication");
    expect(app).toMatchObject({
      "@type": "WebApplication",
      name: "Word counter",
      applicationCategory: text.applicationCategory,
      isAccessibleForFree: true,
      offers: { price: "0", priceCurrency: "USD" },
      dateModified: "2026-09-20",
    });
  });

  it("builds the FAQ data from the same Markdown the page is written from", () => {
    const document = jsonLdDocumentSchema.parse(jsonLdBlocks(html)[0]);
    const faq = document["@graph"].find((node) => node["@type"] === "FAQPage");
    expect(faq && "mainEntity" in faq ? faq.mainEntity.map((item) => item.name) : []).toEqual([
      "Is my text uploaded?",
      "Does it count characters?",
    ]);
    // The answers carry Markdown (bold, a link, inline code); the data has the words a reader sees.
    const answers =
      faq && "mainEntity" in faq ? faq.mainEntity.map((item) => item.acceptedAnswer.text) : [];
    expect(answers[0]).toBe("No. It runs in your browser, so nothing is uploaded.");
    expect(answers[1]).toBe(
      "Yes. It counts characters with and without spaces, and it also counts lines.",
    );
    for (const answer of answers) expect(visibleText(html)).toContain(answer);
  });

  it("shows Quick facts, all from the manifest", () => {
    const facts = quickFacts(manifest);
    const start = html.indexOf('aria-labelledby="quick-facts"');
    const section = html.slice(start, html.indexOf("</section>", start));
    expect(section).toContain("<h2");
    expect(section).toContain('<dl class="ni-facts">');
    for (const fact of facts) {
      expect(section).toContain(`<dt>${fact.label}</dt>`);
      expect(section).toContain(fact.value);
    }
    expect(facts.map((fact) => [fact.label, fact.value])).toEqual([
      ["Price", "Free"],
      ["Sign-up", "Not required"],
      ["Where it runs", "On your device"],
      ["Files uploaded", "No"],
      ["Limits", "No fixed limit"],
      ["Updated", "September 20, 2026"],
    ]);
  });

  it("shows an honest Updated date from manifest.updated, as a <time> element", () => {
    expect(html).toContain('<time datetime="2026-09-20">September 20, 2026</time>');
  });

  it("shows Accepts and Produces only when the manifest lists formats", async () => {
    expect(html).not.toContain("<dt>Accepts</dt>");
    expect(html).not.toContain("<dt>Produces</dt>");
    const withFormats: Tool = {
      ...tool,
      manifest: { ...manifest, accepts: ["PDF", "PNG"], produces: ["PDF"] },
    };
    const other = await container.renderToString(ToolPage, {
      request: at(hosts[0] ?? "", "/word-counter/"),
      props: { tool: withFormats, category: text, related: [], Island, Content },
    });
    expect(other).toContain("<dt>Accepts</dt><dd>PDF, PNG</dd>");
    expect(other).toContain("<dt>Produces</dt><dd>PDF</dd>");
  });

  it("says a server tool runs on our server and uploads files", async () => {
    const server: Tool = { ...tool, manifest: { ...manifest, runtime: "server" } };
    const other = await container.renderToString(ToolPage, {
      request: at(hosts[0] ?? "", "/word-counter/"),
      props: { tool: server, category: text, related: [], Island, Content },
    });
    expect(other).toContain("<dt>Where it runs</dt><dd>On our server</dd>");
    expect(other).toContain("<dt>Files uploaded</dt><dd>Yes</dd>");
  });

  it("shows the limits the manifest sets, and only those", async () => {
    const limited: Tool = {
      ...tool,
      manifest: { ...manifest, limits: { maxInputBytes: 5 * 1024 * 1024, maxFiles: 10 } },
    };
    const other = await container.renderToString(ToolPage, {
      request: at(hosts[0] ?? "", "/word-counter/"),
      props: { tool: limited, category: text, related: [], Island, Content },
    });
    expect(other).toContain("<dt>Limits</dt><dd>Up to 5 MB per input; Up to 10 files at once</dd>");
  });
});

describe("the consistency check itself", () => {
  let html = "";
  beforeAll(async () => {
    html = await container.renderToString(ToolPage, {
      request: at(hosts[0] ?? "", "/word-counter/"),
      props: { tool, category: text, related: [], Island, Content },
    });
  });

  it("finds nothing wrong with an honest page", () => {
    expect(structuredDataProblems(html)).toEqual([]);
  });

  it("catches an invented claim in the structured data", () => {
    const tampered = html.replace(
      '"description":"Count the words',
      '"description":"The fastest word counter on the web. Count the words',
    );
    expect(tampered).not.toBe(html);
    expect(structuredDataProblems(tampered).join()).toContain("which the page does not show");
  });

  it("catches a FAQ answer that is not on the page", () => {
    const tampered = html.replace("Yes. It counts characters", "Yes. It counts every character");
    expect(structuredDataProblems(tampered).join()).toContain("does not show");
  });

  it("catches a breadcrumb that does not match the visible trail", () => {
    const tampered = html.replace('"name":"Text tools"', '"name":"Writing tools"');
    expect(structuredDataProblems(tampered).join()).toContain("breadcrumb");
  });

  it("catches a rating, which the schema does not allow", () => {
    const tampered = html.replace(
      '"isAccessibleForFree":true',
      '"isAccessibleForFree":true,"aggregateRating":{"@type":"AggregateRating","ratingValue":"5"}',
    );
    expect(structuredDataProblems(tampered).join()).toContain("schema");
  });

  it("reports a block that is not JSON", () => {
    const tampered = html.replace('"@context":"https://schema.org"', '"@context":');
    expect(structuredDataProblems(tampered).join()).toContain("does not parse");
  });
});

describe("the category page", () => {
  it("is not indexable while it has no tool: no canonical, no structured data", async () => {
    const html = await container.renderToString(Category, {
      request: at(hosts[0] ?? "", categoryHref(pdf)),
      props: { category: pdf, tool: undefined },
    });
    expect(canonicalLinks(html)).toEqual([]);
    expect(metaProperty(html, "og:url")).toBeUndefined();
    expect(jsonLdBlocks(html)).toEqual([]);
    // It is still a page a link can preview.
    expect(metaProperty(html, "og:image")).toBe("https://networksinsights.com/og/pdf-tools.png");
    expect(new Map(twitterTags(html)).get("twitter:card")).toBe("summary_large_image");
  });
});
