import { expect, test } from "@playwright/test";
import { crawlers } from "../src/config/crawlers";
import { site } from "../src/config/site";
import { jsonLdDocumentSchema } from "../src/lib/seo/schemas";
import { builtPaths, notFoundPath, pages } from "./pages";

// What search engines and share previews read, checked in a real browser against the production
// build (ADR 0038 to 0041). The HTML is the same in every engine, so one engine reads it.
test.skip(({ browserName }) => browserName !== "chromium", "the HTML is the same in every engine");

/** The head of a page, read from the live DOM. */
async function head(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const meta = (selector: string) =>
      [...document.head.querySelectorAll(selector)].map((tag) => tag.getAttribute("content") ?? "");
    return {
      canonicals: [...document.head.querySelectorAll('link[rel="canonical"]')].map(
        (tag) => tag.getAttribute("href") ?? "",
      ),
      og: Object.fromEntries(
        [...document.head.querySelectorAll('meta[property^="og:"]')].map((tag) => [
          tag.getAttribute("property"),
          tag.getAttribute("content"),
        ]),
      ),
      twitter: Object.fromEntries(
        [...document.head.querySelectorAll('meta[name^="twitter:"]')].map((tag) => [
          tag.getAttribute("name"),
          tag.getAttribute("content"),
        ]),
      ),
      description: meta('meta[name="description"]')[0],
      title: document.title,
      jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map(
        (script) => script.textContent ?? "",
      ),
    };
  });
}

for (const item of pages.filter((entry) => entry.status === 200)) {
  test(`${item.path}: canonical, share tags and structured data`, async ({ page }) => {
    await page.goto(item.path);
    const info = await head(page);
    const noindexByDesign = item.path === "/design-system/";
    // A category page is indexable once it lists a tool (ADR 0040).
    const isCategory =
      /^\/[a-z-]+-tools\/$|^\/calculators\/$|^\/converters\/$|^\/generators\/$/.test(item.path);
    const listsTools = isCategory
      ? (await page.locator('[aria-label^="Tools in"] a').count()) > 0
      : true;
    const indexable = !noindexByDesign && listsTools;

    if (indexable) {
      expect(info.canonicals, "one canonical").toEqual([`${site.url}${item.path}`]);
      expect(info.og["og:url"]).toBe(`${site.url}${item.path}`);
    } else {
      expect(info.canonicals).toEqual([]);
      expect(info.og["og:url"]).toBeUndefined();
    }

    // Open Graph and the Twitter/X card, on every page.
    expect(info.og["og:type"]).toBe("website");
    expect(info.og["og:title"]).toBe(info.title);
    expect(info.og["og:description"]).toBe(info.description);
    expect(info.og["og:image:width"]).toBe("1200");
    expect(info.og["og:image:height"]).toBe("630");
    expect(info.og["og:image"]).toMatch(/^https:\/\/networksinsights\.com\/og\/[a-z0-9-]+\.png$/);
    expect(info.twitter["twitter:card"]).toBe("summary_large_image");
    expect(info.twitter["twitter:image"]).toBe(info.og["og:image"]);
    expect(info.twitter["twitter:title"]).toBe(info.title);

    // Structured data: parses, matches its schema, and says what the page shows.
    if (!indexable) {
      expect(info.jsonLd).toEqual([]);
      return;
    }
    expect(info.jsonLd).toHaveLength(1);
    const data = jsonLdDocumentSchema.parse(JSON.parse(info.jsonLd[0] ?? ""));
    const nodes = data["@graph"];

    const crumbs = await page.evaluate(() =>
      [...document.querySelectorAll('nav[aria-label="Breadcrumb"] li')].map((li) => ({
        label: li.textContent?.trim() ?? "",
        href: li.querySelector("a")?.getAttribute("href") ?? undefined,
      })),
    );
    const breadcrumbs = nodes.find((node) => node["@type"] === "BreadcrumbList");
    if (item.path === "/") {
      expect(breadcrumbs).toBeUndefined();
      expect(nodes.map((node) => node["@type"]).sort()).toEqual(["Organization", "WebSite"]);
    } else {
      expect(breadcrumbs && "itemListElement" in breadcrumbs).toBe(true);
      const listed =
        breadcrumbs && "itemListElement" in breadcrumbs ? breadcrumbs.itemListElement : [];
      expect(listed.map((entry) => entry.name)).toEqual(crumbs.map((crumb) => crumb.label));
      expect(listed.map((entry) => entry.item)).toEqual(
        crumbs.map((crumb) => `${site.url}${crumb.href ?? item.path}`),
      );
    }

    // A list of tools in the data is the list on the page, in the same order.
    const collection = nodes.find((node) => node["@type"] === "CollectionPage");
    if (collection && "mainEntity" in collection && collection.mainEntity) {
      const shown = await page.evaluate(() =>
        [...document.querySelectorAll("main ul.ni-linklist a")].map((a) => ({
          name: a.textContent?.trim() ?? "",
          url: a.getAttribute("href") ?? "",
        })),
      );
      const wanted = collection.mainEntity.itemListElement.map((entry) => ({
        name: entry.name,
        url: entry.url.replace(site.url, ""),
      }));
      expect(shown.filter((link) => wanted.some((w) => w.url === link.url))).toEqual(wanted);
    }

    // A tool page: the FAQ and the quick facts in the data are the ones on the page.
    const app = nodes.find((node) => node["@type"] === "WebApplication");
    if (app && "name" in app) {
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(app.name);
      const updated = await page.locator("time[datetime]").first().getAttribute("datetime");
      expect(updated).toBe("dateModified" in app ? app.dateModified : undefined);
      const faq = nodes.find((node) => node["@type"] === "FAQPage");
      if (faq && "mainEntity" in faq) {
        const text = await page.locator("main").innerText();
        const flat = text.replace(/\s+/g, " ");
        for (const entry of faq.mainEntity) {
          expect(flat).toContain(entry.name);
          expect(flat).toContain(entry.acceptedAnswer.text);
        }
      }
    }
  });
}

test.describe("share images", () => {
  test("every page's image exists, is a PNG of 1200 by 630 and is under 5 MB", async ({
    request,
    page,
  }) => {
    const images = new Set<string>();
    for (const path of builtPaths) {
      await page.goto(path);
      const info = await head(page);
      if (info.og["og:image"]) images.add(info.og["og:image"]);
    }
    expect(images.size).toBeGreaterThan(1);
    for (const image of images) {
      const response = await request.get(new URL(image).pathname);
      expect(response.status(), image).toBe(200);
      expect(response.headers()["content-type"], image).toBe("image/png");
      const body = await response.body();
      expect(body.length, image).toBeLessThan(5 * 1024 * 1024);
      expect([...body.subarray(0, 8)], image).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      expect({ width: body.readUInt32BE(16), height: body.readUInt32BE(20) }, image).toEqual({
        width: 1200,
        height: 630,
      });
    }
  });
});

test.describe("robots.txt, sitemaps and llms.txt", () => {
  test("robots.txt allows crawling, names every crawler, and shows a Sitemap line only after launch", async ({
    request,
  }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/plain");
    const text = await response.text();
    expect(text).toMatch(/^User-agent: \*\nAllow: \/$/m);
    expect(text).not.toMatch(/^Disallow: \/$/m);
    for (const crawler of crawlers) expect(text).toContain(`User-agent: ${crawler.token}`);
    if (site.launched) {
      expect(text).toContain(`Sitemap: ${site.url}/sitemap-index.xml`);
    } else {
      expect(text).not.toContain("Sitemap:");
    }
  });

  test("the sitemaps and llms.txt exist only after launch", async ({ request }) => {
    for (const path of ["/sitemap-index.xml", "/sitemap-pages.xml", "/llms.txt"]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(site.launched ? 200 : 404);
    }
  });

  test("when launched, every sitemap URL is a built page that is not noindex", async ({
    request,
    page,
  }) => {
    test.skip(!site.launched, "no sitemap before launch");
    const index = await (await request.get("/sitemap-index.xml")).text();
    const files = [...index.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1] ?? "");
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const xml = await (await request.get(new URL(file).pathname)).text();
      for (const match of xml.matchAll(
        /<url><loc>([^<]*)<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod><\/url>/g,
      )) {
        const path = new URL(match[1] ?? "").pathname;
        expect([notFoundPath, "/design-system/"]).not.toContain(path);
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(200);
        expect(await page.locator('meta[name="robots"][content*="noindex"]').count(), path).toBe(0);
      }
    }
  });
});
