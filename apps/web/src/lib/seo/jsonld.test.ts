import type { ToolManifest } from "@networksinsights/tool-sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { categoryById } from "../../config/categories";
import { site } from "../../config/site";
import type { Tool } from "../registry/build";
import {
  breadcrumbNode,
  collectionNode,
  graph,
  homeNodes,
  serializeJsonLd,
  toolNodes,
} from "./jsonld";
import {
  breadcrumbListSchema,
  collectionPageSchema,
  faqPageSchema,
  jsonLdDocumentSchema,
  organizationSchema,
  webApplicationSchema,
  webSiteSchema,
} from "./schemas";

const category = categoryById("text");
if (!category) throw new Error("the text category is missing");

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
  faq: [
    { question: "Is my text uploaded?", answer: "No. The count happens in your browser." },
    { question: "Does it count characters?", answer: "Yes, with and without spaces." },
  ],
};

describe("the home page graph", () => {
  const [organization, website] = homeNodes();

  it("is an Organization and a WebSite that parse", () => {
    expect(organizationSchema.parse(organization)).toBeTruthy();
    expect(webSiteSchema.parse(website)).toBeTruthy();
  });

  it("takes its words from the site config, never from the page", () => {
    expect(organization.name).toBe(site.name);
    expect(organization.url).toBe("https://networksinsights.com/");
    expect(website.name).toBe(site.name);
    expect(website.alternateName).toBe(site.domain);
    expect(website.description).toBe(site.description);
  });

  it("links the website to its publisher by id", () => {
    expect(website.publisher["@id"]).toBe(organization["@id"]);
  });

  it("claims no profile, no search box and no rating", () => {
    const text = JSON.stringify([organization, website]);
    for (const word of ["sameAs", "potentialAction", "SearchAction", "aggregateRating", "review"]) {
      expect(text).not.toContain(word);
    }
  });
});

describe("breadcrumbNode", () => {
  const crumbs = [
    { label: "Home", href: "/" },
    { label: "Text tools", href: "/text-tools/" },
    { label: "Word counter" },
  ];
  const node = breadcrumbNode(crumbs, "/word-counter/");

  it("parses, with positions 1, 2, 3", () => {
    expect(breadcrumbListSchema.parse(node).itemListElement.map((item) => item.position)).toEqual([
      1, 2, 3,
    ]);
  });

  it("names each crumb as the page does and links it, with the page itself last", () => {
    expect(node.itemListElement.map((item) => item.name)).toEqual([
      "Home",
      "Text tools",
      "Word counter",
    ]);
    expect(node.itemListElement.map((item) => item.item)).toEqual([
      "https://networksinsights.com/",
      "https://networksinsights.com/text-tools/",
      "https://networksinsights.com/word-counter/",
    ]);
  });
});

describe("collectionNode", () => {
  it("lists the pages in the order given", () => {
    const node = collectionNode({
      path: "/text-tools/",
      name: "Text tools",
      description: "Count words.",
      items: [
        { name: "Case converter", href: "/case-converter/" },
        { name: "Word counter", href: "/word-counter/" },
      ],
    });
    const parsed = collectionPageSchema.parse(node);
    expect(parsed.mainEntity?.itemListElement.map((item) => item.name)).toEqual([
      "Case converter",
      "Word counter",
    ]);
    expect(parsed.mainEntity?.itemListElement.map((item) => item.position)).toEqual([1, 2]);
  });

  it("leaves the list out when the page lists nothing", () => {
    const node = collectionNode({
      path: "/tools/",
      name: "All tools",
      description: "x",
      items: [],
    });
    expect(node).not.toHaveProperty("mainEntity");
    expect(collectionPageSchema.parse(node)).toBeTruthy();
  });
});

describe("toolNodes", () => {
  const [app, faq] = toolNodes({ tool, category, faq: tool.faq });

  it("is a free WebApplication that parses", () => {
    const parsed = webApplicationSchema.parse(app);
    expect(parsed.offers).toEqual({ "@type": "Offer", price: "0", priceCurrency: "USD" });
    expect(parsed.isAccessibleForFree).toBe(true);
    expect(parsed.applicationCategory).toBe(category.applicationCategory);
  });

  it("says what the manifest says", () => {
    expect(app.name).toBe(manifest.name);
    expect(app.description).toBe(manifest.summary);
    expect(app.url).toBe("https://networksinsights.com/word-counter/");
    expect(app.dateModified).toBe(manifest.updated);
  });

  it("never claims a rating or a review", () => {
    const text = JSON.stringify(app);
    expect(text).not.toContain("aggregateRating");
    expect(text).not.toContain("review");
    expect(text).not.toContain("ratingValue");
  });

  it("turns the FAQ into a FAQPage with the same words", () => {
    const parsed = faqPageSchema.parse(faq);
    expect(parsed.mainEntity.map((item) => [item.name, item.acceptedAnswer.text])).toEqual(
      tool.faq.map((entry) => [entry.question, entry.answer]),
    );
  });

  it("has no FAQPage when the content has no FAQ", () => {
    expect(toolNodes({ tool, category, faq: [] })).toHaveLength(1);
  });
});

describe("the document", () => {
  it("wraps nodes in one @graph and parses as a whole", () => {
    const document = graph([
      ...homeNodes(),
      breadcrumbNode([{ label: "Home", href: "/" }, { label: "About" }], "/about/"),
    ]);
    expect(jsonLdDocumentSchema.parse(document)["@graph"]).toHaveLength(3);
  });

  it("rejects a property nobody meant to add", () => {
    const [app] = toolNodes({ tool, category, faq: [] });
    const withRating = { ...app, aggregateRating: { ratingValue: 5 } };
    expect(webApplicationSchema.safeParse(withRating).success).toBe(false);
  });

  it("rejects a URL on another host", () => {
    const [organization] = homeNodes();
    expect(
      organizationSchema.safeParse({ ...organization, url: "https://pr-1.example.workers.dev/" })
        .success,
    ).toBe(false);
  });
});

describe("serializeJsonLd", () => {
  it("round-trips to the same JSON", () => {
    const document = graph(homeNodes());
    expect(JSON.parse(serializeJsonLd(document))).toEqual(document);
  });

  it("cannot be used to end the script element or open a comment", () => {
    const hostile = {
      ...tool,
      faq: [{ question: "Q?", answer: "</script><script>alert(1)</script><!--" }],
    };
    const document = graph(toolNodes({ tool: hostile, category, faq: hostile.faq }));
    const text = serializeJsonLd(document);
    expect(text).not.toContain("<");
    expect(text).not.toContain("</script>");
    // And it is still the same data.
    const parsed = jsonLdDocumentSchema.parse(JSON.parse(text));
    const faq = parsed["@graph"].find((node) => node["@type"] === "FAQPage");
    expect(faq && "mainEntity" in faq && faq.mainEntity[0]?.acceptedAnswer.text).toBe(
      "</script><script>alert(1)</script><!--",
    );
  });

  it("escapes the two line separators that older JavaScript rejects", () => {
    const separators = String.fromCharCode(0x2028, 0x2029);
    const document = graph(
      toolNodes({ tool, category, faq: [{ question: "Q?", answer: `a${separators}b` }] }),
    );
    const text = serializeJsonLd(document);
    expect(text).not.toContain(String.fromCharCode(0x2028));
    expect(text).not.toContain(String.fromCharCode(0x2029));
    expect(JSON.stringify(JSON.parse(text))).toContain("a");
  });
});
