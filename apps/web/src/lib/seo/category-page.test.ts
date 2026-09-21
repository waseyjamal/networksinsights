import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type Category, categories, categoryHref } from "../../config/categories";
import { toolOf } from "./test-tools";

// The category page reads the registry, and the real registry has no tools yet (Mission 13). This
// file gives it two, so the page that has tools can be compared with the one that has none.
vi.mock("../registry", async () => {
  const tools = [toolOf("merge-pdf", "pdf"), toolOf("split-pdf", "pdf")];
  return {
    tools,
    getTool: (id: string) => tools.find((tool) => tool.manifest.id === id),
    toolsInCategory: (id: string) => tools.filter((tool) => tool.manifest.category === id),
    toolCount: (id: string) => tools.filter((tool) => tool.manifest.category === id).length,
  };
});

const { default: CategoryPage } = await import("../../pages/[slug].astro");
const { default: ToolsPage } = await import("../../pages/tools.astro");
const { structuredDataProblems } = await import("./consistency");
const html = await import("./html");
const { jsonLdDocumentSchema } = await import("./schemas");

const pdf = categories.find((category) => category.id === "pdf");
const image = categories.find((category) => category.id === "image");
if (!pdf || !image) throw new Error("categories are missing");

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

const render = (category: Category, host = "https://pr-3-networksinsights.example.workers.dev") =>
  container.renderToString(CategoryPage, {
    request: new Request(`${host}${categoryHref(category)}`),
    props: { category, tool: undefined },
  });

describe("a category page that has tools", () => {
  it("is indexable: an absolute canonical on the production domain, from any host", async () => {
    for (const host of [
      "https://networksinsights.com",
      "https://pr-3-networksinsights.example.workers.dev",
    ]) {
      expect(html.canonicalLinks(await render(pdf, host)), host).toEqual([
        "https://networksinsights.com/pdf-tools/",
      ]);
    }
  });

  it("carries a CollectionPage that lists its tools in page order, and breadcrumbs", async () => {
    const page = await render(pdf);
    const [block] = html.jsonLdBlocks(page);
    const document = jsonLdDocumentSchema.parse(block);
    const types = document["@graph"].map((node) => node["@type"]).sort();
    expect(types).toEqual(["BreadcrumbList", "CollectionPage"]);
    const collection = document["@graph"].find((node) => node["@type"] === "CollectionPage");
    expect(
      collection && "mainEntity" in collection
        ? collection.mainEntity?.itemListElement.map((item) => item.name)
        : [],
    ).toEqual(["Merge Pdf", "Split Pdf"]);
  });

  it("says nothing in its structured data that the page does not show", async () => {
    expect(structuredDataProblems(await render(pdf))).toEqual([]);
  });

  it("uses its own share image", async () => {
    expect(html.metaProperty(await render(pdf), "og:image")).toBe(
      "https://networksinsights.com/og/pdf-tools.png",
    );
  });
});

describe("a category page that has none", () => {
  it("is not indexable: no canonical, no og:url, no structured data", async () => {
    const page = await render(image);
    expect(html.canonicalLinks(page)).toEqual([]);
    expect(html.metaProperty(page, "og:url")).toBeUndefined();
    expect(html.jsonLdBlocks(page)).toEqual([]);
  });

  it("still has a share card, so a link to it previews", async () => {
    const page = await render(image);
    expect(html.metaProperty(page, "og:image")).toBe(
      "https://networksinsights.com/og/image-tools.png",
    );
    expect(new Map(html.twitterTags(page)).get("twitter:card")).toBe("summary_large_image");
  });
});

describe("/tools/ with tools", () => {
  it("lists every tool in the structured data, in the order the page lists them", async () => {
    const page = await container.renderToString(ToolsPage, {
      request: new Request("https://networksinsights.com/tools/"),
    });
    const document = jsonLdDocumentSchema.parse(html.jsonLdBlocks(page)[0]);
    const collection = document["@graph"].find((node) => node["@type"] === "CollectionPage");
    expect(
      collection && "mainEntity" in collection
        ? collection.mainEntity?.itemListElement.map((item) => item.url)
        : [],
    ).toEqual([
      "https://networksinsights.com/merge-pdf/",
      "https://networksinsights.com/split-pdf/",
    ]);
    expect(structuredDataProblems(page)).toEqual([]);
  });
});
