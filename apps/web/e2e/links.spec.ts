import { expect, test } from "@playwright/test";
import { categories } from "../src/config/categories";
import { builtPaths, notFoundPath, pages } from "./pages";

// Checks made on the built site with plain HTTP requests, so they run once, in one browser.
test.skip(({ browserName }) => browserName !== "chromium", "HTTP-only checks run once");

/** The values of every href in the HTML, in order. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/<a\s[^>]*?href="([^"]*)"/g)].map((match) => match[1] ?? "");
}

test("every internal link returns 200 directly, without a redirect", async ({
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "http://127.0.0.1:4321").origin;
  const seen = new Set<string>();
  const queue = [...builtPaths, notFoundPath];
  const failures: string[] = [];
  let linksChecked = 0;

  while (queue.length > 0) {
    const path = queue.shift();
    if (path === undefined || seen.has(path)) continue;
    seen.add(path);
    const response = await request.get(path, { maxRedirects: 0 });
    const expected = path === notFoundPath ? 404 : 200;
    if (response.status() !== expected) {
      failures.push(`${path} -> ${response.status()} (expected ${expected})`);
      continue;
    }
    const type = response.headers()["content-type"] ?? "";
    if (!type.includes("text/html")) continue;

    const html = await response.text();
    for (const href of hrefs(html)) {
      // In-page anchors must point at something on the same page.
      if (href.startsWith("#")) {
        const id = href.slice(1);
        if (id && !html.includes(`id="${id}"`)) failures.push(`${path}: dead anchor ${href}`);
        continue;
      }
      const url = new URL(href, `${origin}${path}`);
      if (url.origin !== origin) continue; // external: not ours to check
      linksChecked++;
      const target = url.pathname;
      // Canonical form: folders end in a slash (trailingSlash: "always").
      if (!target.endsWith("/") && !/\.[a-z0-9]+$/.test(target)) {
        failures.push(`${path}: link ${href} has no trailing slash`);
      }
      if (!seen.has(target)) queue.push(target);
    }
  }

  console.log(`link check: ${seen.size} pages crawled, ${linksChecked} internal links followed`);
  expect(failures).toEqual([]);
  // The crawl reached every page there is, including the ones only linked from the footer.
  for (const path of builtPaths.filter((p) => p !== "/design-system/")) {
    expect(seen.has(path), `${path} is reachable by links`).toBe(true);
  }
});

test("the design-system page is not linked from any other page", async ({ request }) => {
  for (const path of builtPaths.filter((p) => p !== "/design-system/")) {
    const html = await (await request.get(path)).text();
    expect(html, path).not.toContain("/design-system");
  }
});

test("the site name is never glued to the next word", async ({ request }) => {
  // A formatter that moves {site.name} onto its own line can drop the space after it.
  for (const item of pages) {
    const html = await (await request.get(item.path)).text();
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]*>/g, " ");
    expect(text.match(/NetworksInsights[a-z]/g), `${item.path} text`).toBeNull();
  }
});

test("titles and descriptions are unique and well formed on every page", async ({ request }) => {
  const titles = new Map<string, string>();
  const descriptions = new Map<string, string>();

  for (const item of pages) {
    const html = await (await request.get(item.path)).text();
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replaceAll("&amp;", "&") ?? "";
    const description =
      html
        .match(/<meta name="description" content="([^"]*)"/)?.[1]
        ?.replaceAll("&amp;", "&")
        .replaceAll("&#39;", "'") ?? "";

    expect(title, `${item.path} title`).toBe(item.title);
    expect(title, `${item.path} title format`).toMatch(
      /^(?:NetworksInsights — Free online tools|.+ \| NetworksInsights)$/,
    );
    expect(description.length, `${item.path} description length`).toBeGreaterThan(30);
    expect(description.length, `${item.path} description length`).toBeLessThan(160);

    expect(titles.get(title), `title of ${item.path} repeats ${titles.get(title)}`).toBeUndefined();
    expect(
      descriptions.get(description),
      `description of ${item.path} repeats ${descriptions.get(description)}`,
    ).toBeUndefined();
    titles.set(title, item.path);
    descriptions.set(description, item.path);
  }

  expect(titles.size).toBe(pages.length);
  // Each category page carries its own description from the config.
  for (const category of categories) expect(descriptions.has(category.metaDescription)).toBe(true);
});
