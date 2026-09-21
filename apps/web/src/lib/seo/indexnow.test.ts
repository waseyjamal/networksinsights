import { describe, expect, it, vi } from "vitest";
import {
  batches,
  changedUrls,
  INDEXNOW_BATCH_SIZE,
  INDEXNOW_ENDPOINT,
  isAccepted,
  isValidKey,
  keyFilePath,
  requestBody,
  submitUrls,
  urlsOfSitemaps,
} from "./indexnow";
import { buildSitemapFiles, renderUrlset } from "./sitemap";
import { toolOf } from "./test-tools";

const key = "0123456789abcdef0123456789abcdef";
const u = (path: string, lastmod?: string) => ({
  loc: `https://networksinsights.com${path}`,
  lastmod,
});

describe("the key", () => {
  it("accepts 8 to 128 letters, digits and dashes", () => {
    for (const good of [key, "abcdefgh", "A-b-C-1-2-3-4-5", "a".repeat(128)]) {
      expect(isValidKey(good), good).toBe(true);
    }
  });

  it("refuses anything else, so a bad value never becomes a file name", () => {
    for (const bad of [
      undefined,
      "",
      "short",
      "a".repeat(129),
      "has space in it",
      "../../etc/passwd",
      "key.txt",
      "key/with/slash",
      "ключ-ключ-ключ",
      "key\nkey-key-key",
    ]) {
      expect(isValidKey(bad), String(bad)).toBe(false);
    }
  });

  it("is published at the root, named after the key", () => {
    expect(keyFilePath(key)).toBe(`/${key}.txt`);
  });
});

describe("which URLs changed", () => {
  it("announces new URLs and URLs whose lastmod changed, and nothing else", () => {
    const previous = [u("/", "2026-09-01"), u("/a/", "2026-09-01"), u("/b/", "2026-09-01")];
    const next = [
      u("/", "2026-09-01"),
      u("/a/", "2026-09-05"),
      u("/b/", "2026-09-01"),
      u("/c/", "2026-09-05"),
    ];
    expect(changedUrls(previous, next)).toEqual([
      "https://networksinsights.com/a/",
      "https://networksinsights.com/c/",
    ]);
  });

  it("does not announce a URL that was removed, or an unchanged site", () => {
    const previous = [u("/", "2026-09-01"), u("/gone/", "2026-09-01")];
    expect(changedUrls(previous, [u("/", "2026-09-01")])).toEqual([]);
    expect(changedUrls(previous, previous)).toEqual([]);
  });

  it("announces everything on the first deploy, when there is nothing before it", () => {
    expect(changedUrls([], [u("/z/"), u("/a/")])).toEqual([
      "https://networksinsights.com/a/",
      "https://networksinsights.com/z/",
    ]);
  });

  it("reads the URLs out of the sitemaps the site writes", () => {
    const files = buildSitemapFiles([toolOf("word-counter", "text", "2026-09-19")]);
    const state = urlsOfSitemaps(files.map((file) => renderUrlset(file.entries)));
    expect(state.map((item) => item.loc)).toContain("https://networksinsights.com/word-counter/");
    expect(state.find((item) => item.loc.endsWith("/word-counter/"))?.lastmod).toBe("2026-09-19");
  });

  it("sees a tool update as one changed URL, plus the pages that list it", () => {
    const before = urlsOfSitemaps(
      buildSitemapFiles([toolOf("word-counter", "text", "2026-09-19")]).map((file) =>
        renderUrlset(file.entries),
      ),
    );
    const after = urlsOfSitemaps(
      buildSitemapFiles([toolOf("word-counter", "text", "2099-01-01")]).map((file) =>
        renderUrlset(file.entries),
      ),
    );
    expect(changedUrls(before, after)).toEqual([
      "https://networksinsights.com/",
      "https://networksinsights.com/text-tools/",
      "https://networksinsights.com/tools/",
      "https://networksinsights.com/word-counter/",
    ]);
  });
});

describe("requests", () => {
  it("cuts a list into requests of at most 10,000 URLs", () => {
    expect(INDEXNOW_BATCH_SIZE).toBe(10_000);
    const urls = Array.from(
      { length: 25_001 },
      (_, index) => `https://networksinsights.com/t${index}/`,
    );
    expect(batches(urls).map((chunk) => chunk.length)).toEqual([10_000, 10_000, 5_001]);
    expect(batches([])).toEqual([]);
  });

  it("writes the body the protocol asks for", () => {
    expect(requestBody(key, ["https://networksinsights.com/a/"])).toEqual({
      host: "networksinsights.com",
      key,
      keyLocation: `https://networksinsights.com/${key}.txt`,
      urlList: ["https://networksinsights.com/a/"],
    });
  });

  it("refuses a URL on another host, which the service would answer 422", () => {
    expect(() => requestBody(key, ["https://example.com/a/"])).toThrow(/Not a URL of/);
    expect(() => requestBody(key, ["https://pr-1.x.workers.dev/a/"])).toThrow(/Not a URL of/);
  });

  it("refuses an invalid key", () => {
    expect(() => requestBody("nope", [])).toThrow(/key must be/);
  });
});

describe("submitting", () => {
  it("posts JSON to the shared endpoint, one request per batch", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 202 }));
    const urls = Array.from(
      { length: 10_001 },
      (_, index) => `https://networksinsights.com/t${index}/`,
    );
    const results = await submitUrls(key, urls, fetchFn as unknown as typeof fetch);
    expect(results).toEqual([
      { urls: 10_000, status: 202 },
      { urls: 1, status: 202 },
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [endpoint, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe(INDEXNOW_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toContain("application/json");
    expect(JSON.parse(String(init.body)).key).toBe(key);
  });

  it("sends nothing when there is nothing to send", async () => {
    const fetchFn = vi.fn();
    expect(await submitUrls(key, [], fetchFn as unknown as typeof fetch)).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("counts 200 and 202 as accepted, and 403, 422 and 429 as not", () => {
    expect([200, 202].every(isAccepted)).toBe(true);
    expect([400, 403, 422, 429, 500].some(isAccepted)).toBe(false);
  });
});
