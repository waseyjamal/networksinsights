import { readFileSync } from "node:fs";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { expect, type Page } from "@playwright/test";
import { toBytes } from "../src/lib/color";
import { parseTokens, type Theme, themeColors } from "../src/lib/tokens";

// The expected colors come from the same tokens.css the site is built from.
const tokens = parseTokens(
  readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8"),
);

/** The page background of a theme as sRGB bytes. */
export function expectedBackground(theme: Theme): [number, number, number] {
  const bg = themeColors(tokens, theme).get("bg");
  if (!bg) throw new Error("tokens.css has no --bg token");
  return toBytes(bg);
}

/** The painted background of <body> as sRGB bytes, converted by the browser itself. */
export async function bodyBackground(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
    if (!context) throw new Error("No 2d canvas context");
    context.fillStyle = getComputedStyle(document.body).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
  });
}

/** Collects console errors, uncaught exceptions and failed requests. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => errors.push(`requestfailed: ${request.url()}`));
  return errors;
}

export const compressed = {
  gzip: (data: Buffer | string) => gzipSync(data, { level: 9 }).length,
  brotli: (data: Buffer | string) =>
    brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
};

/**
 * Records every stylesheet, script and font response of one page load. Bodies are read lazily,
 * only by the test that needs them: fetching all of them eagerly makes some engines hang when the
 * browser context is torn down.
 */
export function collectResponses(page: Page) {
  const items: Array<{ url: string; type: string; body: () => Promise<Buffer> }> = [];
  page.on("response", (response) => {
    const type = response.request().resourceType();
    if (["stylesheet", "script", "font"].includes(type)) {
      items.push({ url: response.url(), type, body: () => response.body() });
    }
  });
  return items;
}

/** The most the one search loader script may weigh, gzip (ADR 0046). */
export const LOADER_MAX_GZIP_BYTES = 2048;

/** What the one deferred loader script weighs. */
export interface ScriptAudit {
  loader: { url: string; raw: number; gzip: number };
}

/** Every request URL of a page, from the first navigation on. */
export function collectRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

/** True for a request that belongs to search: the index file or the search module chunk. */
export const isSearchRequest = (url: string) =>
  /^\/(?:search-index\.[0-9a-f]+\.json|_astro\/search-ui\.[\w-]+\.js)$/.test(new URL(url).pathname);

/**
 * Asserts the zero-JavaScript rule as it stands since Mission 11 (ADR 0046): exactly one script
 * file, the search loader, at most 2 KB gzip; one inline script, the theme script; no island; and
 * no request for the search module or the index. `responses` and `requests` must have been
 * collected before the page was loaded.
 */
export async function expectOnlySearchLoader(
  page: Page,
  responses: ReturnType<typeof collectResponses>,
  requests: string[],
): Promise<ScriptAudit> {
  const scripts = responses.filter((response) => response.type === "script");
  expect(
    scripts.map((script) => script.url),
    "script files requested",
  ).toHaveLength(1);
  const [script] = scripts;
  if (!script) throw new Error("unreachable: the length was just asserted");
  expect(await page.locator("script[src]").count(), "script elements with a src").toBe(1);
  await expect(page.locator("script[src]")).toHaveAttribute("type", "module");
  expect(await page.locator("astro-island").count(), "islands").toBe(0);

  // The theme script is the only inline script: the JSON-LD blocks are data, not code.
  const inline = await page.evaluate(() =>
    [...document.querySelectorAll('script:not([src]):not([type="application/ld+json"])')].map(
      (element) => element.textContent ?? "",
    ),
  );
  expect(inline, "inline scripts").toHaveLength(1);
  expect(inline[0]).toContain("ni-theme");

  const body = await script.body();
  const audit = { url: script.url, raw: body.length, gzip: compressed.gzip(body) };
  expect(audit.gzip, "loader gzip bytes").toBeLessThanOrEqual(LOADER_MAX_GZIP_BYTES);

  // Nothing of search is fetched until intent: not the module, not the index.
  expect(requests.filter(isSearchRequest), "search requests before intent").toEqual([]);
  return { loader: audit };
}
