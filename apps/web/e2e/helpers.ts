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

/** The most each analytics file may weigh, gzip (ADR 0051): Umami's tracker, then ours. */
export const TRACKER_MAX_GZIP_BYTES = 3072;
export const EVENTS_MAX_GZIP_BYTES = 1024;

/**
 * True for the two analytics files a build with a website id adds to every page (ADR 0051). The
 * E2E job builds with a test id, so they are present there; a local build without one has neither.
 */
export const isAnalyticsScript = (url: string) =>
  /^\/_astro\/(?:umami-tracker\.|Analytics\.astro_astro_type_script_)[\w.-]+\.js$/.test(
    new URL(url).pathname,
  );

interface FileAudit {
  url: string;
  raw: number;
  gzip: number;
}

/** What the one deferred loader script weighs, and the analytics files when the build has them. */
export interface ScriptAudit {
  loader: FileAudit;
  analytics: FileAudit[];
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
 * no request for the search module or the index. Since Mission 16 (ADR 0051) a build with
 * analytics also carries the two analytics files, which expectAnalyticsScripts checks.
 * `responses` and `requests` must have been collected before the page was loaded.
 */
export async function expectOnlySearchLoader(
  page: Page,
  responses: ReturnType<typeof collectResponses>,
  requests: string[],
): Promise<ScriptAudit> {
  const all = responses.filter((response) => response.type === "script");
  const scripts = all.filter((script) => !isAnalyticsScript(script.url));
  expect(
    scripts.map((script) => script.url),
    "script files requested",
  ).toHaveLength(1);
  const [script] = scripts;
  if (!script) throw new Error("unreachable: the length was just asserted");
  const analytics = await expectAnalyticsScripts(
    page,
    all.filter((s) => isAnalyticsScript(s.url)),
  );
  const loaderElement = page.locator(
    'script[src]:not([data-website-id]):not([src*="Analytics.astro_astro_type_script_"])',
  );
  expect(await loaderElement.count(), "script elements with a src, besides analytics").toBe(1);
  await expect(loaderElement).toHaveAttribute("type", "module");
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
  return { loader: audit, analytics };
}

/**
 * In a build with analytics: exactly the tracker, as a classic deferred script, and our events
 * module, each within its budget (ADR 0051). In a build without: no trace of either.
 */
export async function expectAnalyticsScripts(
  page: Page,
  responses: ReturnType<typeof collectResponses>,
): Promise<FileAudit[]> {
  const tracker = page.locator("script[data-website-id]");
  if (responses.length === 0) {
    expect(await tracker.count(), "analytics tracker elements").toBe(0);
    return [];
  }
  expect(responses.map((response) => new URL(response.url).pathname).sort()).toEqual([
    expect.stringMatching(/^\/_astro\/Analytics\.astro_astro_type_script_/),
    expect.stringMatching(/^\/_astro\/umami-tracker\./),
  ]);
  expect(await tracker.count(), "analytics tracker elements").toBe(1);
  await expect(tracker).toHaveAttribute("defer", "");
  expect(await tracker.getAttribute("type"), "the tracker is a classic script").toBeNull();
  const audits: FileAudit[] = [];
  for (const response of responses) {
    const body = await response.body();
    const audit = { url: response.url, raw: body.length, gzip: compressed.gzip(body) };
    const max = audit.url.includes("umami-tracker")
      ? TRACKER_MAX_GZIP_BYTES
      : EVENTS_MAX_GZIP_BYTES;
    expect(audit.gzip, `${audit.url} gzip bytes`).toBeLessThanOrEqual(max);
    audits.push(audit);
  }
  return audits;
}
