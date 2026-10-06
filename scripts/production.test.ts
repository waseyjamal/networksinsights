import { describe, expect, it, vi } from "vitest";
import { HTML_CACHE_CONTROL, IMMUTABLE, securityHeaders } from "../apps/web/src/config/headers";
import { formatChecks, runProductionChecks, runWithRetries } from "./lib/production";

// `pnpm check:production` against a pretend site. The important case is the redirect: a 307 (what
// Cloudflare sends by itself) must fail, and a 301 or 308 must pass.

const BASE = "https://networksinsights.com";
const INDEX = "/search-index.0123456789ab.json";
const SCRIPT = "/_astro/SearchDialog.abc123.js";
const META_POLICY = "default-src 'none'; script-src 'self'";
const HEADER_POLICY = `${META_POLICY}; frame-ancestors 'none'`;
const home = `<html><head><meta http-equiv="content-security-policy" content="${META_POLICY}"><link rel="canonical" href="${BASE}/"></head><body><dialog data-ni-search data-index="${INDEX}"></dialog><script type="module" src="${SCRIPT}"></script></body></html>`;

/** The headers the site sends on a path, as dist/_headers makes Cloudflare send them. */
function siteHeaders(path: string, preview: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    ...securityHeaders,
    "content-security-policy": HEADER_POLICY,
    "cache-control": path.startsWith("/_astro/") ? IMMUTABLE : HTML_CACHE_CONTROL,
  };
  if (path.startsWith("/og/") || path.startsWith("/favicon")) {
    headers["Cross-Origin-Resource-Policy"] = "cross-origin";
  }
  if (preview) headers["x-robots-tag"] = "noindex";
  return headers;
}

interface Fake {
  tools?: { status: number; location?: string };
  robots?: string;
  home?: string;
  favicon?: number;
  missing?: number;
  launched?: boolean;
  /** The Cache-Control the search index is served with. */
  indexCache?: string;
  indexStatus?: number;
  /** The Cache-Control the service worker is served with (ADR 0052). */
  workerCache?: string;
  /** The Cache-Control the versioned vendor files are served with (ADR 0061). */
  vendorCache?: string;
  /** Answer as a preview deployment does: with X-Robots-Tag: noindex. */
  preview?: boolean;
  /** Changes the headers of one path after the site's own are set. */
  headers?: (path: string, headers: Record<string, string>) => void;
}

/** A fetch that answers like the site does, with the parts a test wants to change. */
function fakeFetch(fake: Fake = {}): typeof fetch {
  const robots = fake.robots ?? "User-agent: *\nAllow: /\n";
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const respond = (status: number, body = "", extra: Record<string, string> = {}) => {
      const headers = { ...siteHeaders(path, fake.preview ?? false), ...extra };
      fake.headers?.(path, headers);
      return new Response(status === 301 || status === 307 || status === 308 ? null : body, {
        status,
        headers,
      });
    };
    if (path === "/tools") {
      const tools = fake.tools ?? { status: 301, location: "/tools/" };
      return respond(tools.status, "", tools.location ? { location: tools.location } : {});
    }
    if (path === "/") return respond(200, fake.home ?? home);
    if (path === INDEX) {
      const headers: Record<string, string> = {
        "cache-control": fake.indexCache ?? "public, max-age=31536000, immutable",
      };
      return respond(fake.indexStatus ?? 200, '{"version":1,"tools":[]}', headers);
    }
    if (path === "/tools/") return respond(200, "<html></html>");
    if (path === "/favicon.ico") return respond(fake.favicon ?? 200, "x");
    if (path === "/robots.txt") return respond(200, robots);
    if (path === "/sw.js" || path === "/manifest.webmanifest") {
      return respond(200, "x", fake.workerCache ? { "cache-control": fake.workerCache } : {});
    }
    if (
      path.startsWith("/vendor/pdfjs/") ||
      path.startsWith("/vendor/libheif/") ||
      path.startsWith("/vendor/wasm-media-encoders/") ||
      path.startsWith("/vendor/onnxruntime-web/") ||
      path.startsWith("/models/")
    ) {
      return respond(200, "x", { "cache-control": fake.vendorCache ?? IMMUTABLE });
    }
    if (path.startsWith("/vendor/tesseract/")) return respond(200, "x");
    if (path === "/sitemap-index.xml" || path === "/llms.txt") return respond(200, "x");
    if (path === SCRIPT || path === "/og/home.png") return respond(200, "x");
    return respond(fake.missing ?? 404, "not found");
  }) as typeof fetch;
}

const redirectCheck = (checks: Awaited<ReturnType<typeof runProductionChecks>>) =>
  checks.find((check) => check.name.includes("redirects permanently"));

describe("the redirect", () => {
  it("passes for a 301 to /tools/, relative or absolute", async () => {
    for (const location of ["/tools/", `${BASE}/tools/`]) {
      const checks = await runProductionChecks({
        fetchFn: fakeFetch({ tools: { status: 301, location } }),
        launched: false,
      });
      expect(redirectCheck(checks)?.ok, location).toBe(true);
    }
  });

  it("passes for a 308", async () => {
    const checks = await runProductionChecks({
      fetchFn: fakeFetch({ tools: { status: 308, location: "/tools/" } }),
      launched: false,
    });
    expect(redirectCheck(checks)?.ok).toBe(true);
  });

  it("fails for a 307, Cloudflare's own temporary redirect, and says where to fix it", async () => {
    const checks = await runProductionChecks({
      fetchFn: fakeFetch({ tools: { status: 307, location: "/tools/" } }),
      launched: false,
    });
    expect(redirectCheck(checks)?.ok).toBe(false);
    expect(redirectCheck(checks)?.detail).toContain("answered 307");
    expect(redirectCheck(checks)?.detail).toContain("docs/runbooks/seo-redirects.md");
  });

  it("fails for a 302, for a permanent redirect to the wrong place, and for no redirect at all", async () => {
    for (const tools of [
      { status: 302, location: "/tools/" },
      { status: 301, location: "/other/" },
      { status: 301, location: "/tools" },
      { status: 301 },
      { status: 200 },
      { status: 404 },
    ]) {
      const checks = await runProductionChecks({ fetchFn: fakeFetch({ tools }), launched: false });
      expect(redirectCheck(checks)?.ok, JSON.stringify(tools)).toBe(false);
    }
  });

  it("never follows the redirect it is checking", async () => {
    const fetchFn = vi.fn(fakeFetch());
    await runProductionChecks({ fetchFn, launched: false });
    for (const call of fetchFn.mock.calls) expect((call[1] as RequestInit).redirect).toBe("manual");
  });
});

describe("everything else on the site", () => {
  it("wants the versioned vendor folders cached for good, and Tesseract revalidated (ADR 0061)", async () => {
    const pass = await runProductionChecks({ fetchFn: fakeFetch(), launched: false });
    const vendor = pass.filter((check) => check.name.startsWith("/vendor/"));
    const model = pass.find((check) => check.name.startsWith("/models/"));
    expect(model?.name).toBe(
      "/models/modnet/7bad6522b3cde602/LICENSE.txt (a content-addressed model) is cached for good",
    );
    expect(model?.ok).toBe(true);
    expect(vendor.map((check) => check.name)).toEqual([
      "/vendor/pdfjs/6.3.289/cmaps/LICENSE.txt (a versioned vendor folder) is cached for good",
      "/vendor/libheif/1.23.2/LICENSE.txt (a versioned vendor folder) is cached for good",
      "/vendor/wasm-media-encoders/0.7.0/mp3.wasm (a versioned vendor folder) is cached for good",
      "/vendor/onnxruntime-web/1.30.0/ort-wasm-simd-threaded.mjs (a versioned vendor folder) is cached for good",
      "/vendor/tesseract/7.0.0/LICENSE-tesseract.js.txt is revalidated on every visit",
    ]);
    expect(vendor.every((check) => check.ok)).toBe(true);
    const fail = await runProductionChecks({
      fetchFn: fakeFetch({ vendorCache: HTML_CACHE_CONTROL }),
      launched: false,
    });
    const failed = fail.filter((check) => check.name.startsWith("/vendor/") && !check.ok);
    expect(failed).toHaveLength(4);
    expect(failed[0]?.detail).toContain("versionedVendorPaths");
  });

  it("fails when Tesseract's folder is cached for good", async () => {
    const checks = await runProductionChecks({
      fetchFn: fakeFetch({
        headers: (path, headers) => {
          if (path.startsWith("/vendor/tesseract/")) headers["cache-control"] = IMMUTABLE;
        },
      }),
      launched: false,
    });
    expect(checks.find((check) => check.name.includes("tesseract"))?.ok).toBe(false);
  });

  it("fails when the service worker is cached for good (ADR 0052)", async () => {
    const checks = await runProductionChecks({
      fetchFn: fakeFetch({ workerCache: "public, max-age=31536000, immutable" }),
      launched: false,
    });
    expect(checks.find((check) => check.name.startsWith("/sw.js"))?.ok).toBe(false);
  });

  it("passes when the site is as expected, before launch", async () => {
    const checks = await runProductionChecks({ fetchFn: fakeFetch(), launched: false });
    expect(checks.filter((check) => !check.ok)).toEqual([]);
  });

  it("fails when the redirect rule catches a file, like the favicon", async () => {
    const checks = await runProductionChecks({
      fetchFn: fakeFetch({ favicon: 301 }),
      launched: false,
    });
    expect(checks.find((check) => check.name.startsWith("/favicon.ico"))?.ok).toBe(false);
  });

  it("fails when an unknown page does not answer 404", async () => {
    const checks = await runProductionChecks({
      fetchFn: fakeFetch({ missing: 200 }),
      launched: false,
    });
    expect(checks.find((check) => check.name.includes("unknown page"))?.ok).toBe(false);
  });

  it("fails when the home page's canonical is not the production home page", async () => {
    const wrong = '<link rel="canonical" href="https://pr-1.x.workers.dev/">';
    const checks = await runProductionChecks({
      fetchFn: fakeFetch({ home: wrong }),
      launched: false,
    });
    expect(checks.find((check) => check.name.includes("canonical"))?.ok).toBe(false);
  });

  it("wants no Sitemap line before launch, and one after", async () => {
    const withSitemap = `User-agent: *\nAllow: /\nSitemap: ${BASE}/sitemap-index.xml\n`;
    const early = await runProductionChecks({
      fetchFn: fakeFetch({ robots: withSitemap }),
      launched: false,
    });
    expect(early.find((check) => check.name.startsWith("robots.txt"))?.ok).toBe(false);
    const late = await runProductionChecks({
      fetchFn: fakeFetch({ robots: withSitemap }),
      launched: true,
    });
    expect(late.filter((check) => !check.ok)).toEqual([]);
    const lateWithout = await runProductionChecks({ fetchFn: fakeFetch(), launched: true });
    expect(lateWithout.find((check) => check.name.startsWith("robots.txt"))?.ok).toBe(false);
  });

  it("checks the sitemap index and llms.txt only after launch", async () => {
    const early = await runProductionChecks({ fetchFn: fakeFetch(), launched: false });
    expect(early.some((check) => check.name.includes("sitemap-index"))).toBe(false);
    const late = await runProductionChecks({
      fetchFn: fakeFetch({ robots: `Sitemap: ${BASE}/sitemap-index.xml` }),
      launched: true,
    });
    expect(late.some((check) => check.name.includes("sitemap-index"))).toBe(true);
    expect(late.some((check) => check.name.includes("llms.txt"))).toBe(true);
  });
});

describe("waiting for a deploy to settle", () => {
  it("tries again until the checks pass", async () => {
    let calls = 0;
    const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === "/tools") calls += 1;
      const first = calls < 3;
      return fakeFetch({
        tools: first ? { status: 307, location: "/tools/" } : { status: 301, location: "/tools/" },
      })(input, init);
    }) as typeof fetch;
    const sleeps: number[] = [];
    const checks = await runWithRetries({
      fetchFn: flaky,
      launched: false,
      attempts: 5,
      waitMs: 10_000,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(checks.every((check) => check.ok)).toBe(true);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([10_000, 10_000]);
  });

  it("gives up after the attempts and returns the last failure", async () => {
    const sleeps: number[] = [];
    const checks = await runWithRetries({
      fetchFn: fakeFetch({ tools: { status: 307, location: "/tools/" } }),
      launched: false,
      attempts: 3,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(checks.some((check) => !check.ok)).toBe(true);
    expect(sleeps).toHaveLength(2);
  });

  it("does not wait when the first try passes", async () => {
    const sleep = vi.fn(async () => {});
    await runWithRetries({ fetchFn: fakeFetch(), launched: false, attempts: 5, sleep });
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("the summary", () => {
  it("shows what failed and how to fix it, and says so when everything passes", async () => {
    const bad = await runProductionChecks({
      fetchFn: fakeFetch({ tools: { status: 307, location: "/tools/" } }),
      launched: false,
    });
    const text = formatChecks(bad, BASE);
    expect(text).toContain("✗ /tools redirects permanently to /tools/");
    expect(text).toContain("docs/runbooks/seo-redirects.md");
    expect(text).toContain("1 check failed.");
    const good = await runProductionChecks({ fetchFn: fakeFetch(), launched: false });
    expect(formatChecks(good, BASE)).toContain("All checks pass.");
  });
});

describe("the search index", () => {
  const indexCheck = (checks: Awaited<ReturnType<typeof runProductionChecks>>) =>
    checks.find((check) => check.name.includes("search-index"));

  it("passes when the home page names it and it is served with an immutable, year-long cache", async () => {
    const checks = await runProductionChecks({ fetchFn: fakeFetch(), launched: false });
    expect(indexCheck(checks)?.ok).toBe(true);
    expect(indexCheck(checks)?.name).toContain(INDEX);
  });

  it("fails when it is served without the cache header, and points at _headers", async () => {
    const checks = await runProductionChecks({
      fetchFn: fakeFetch({ indexCache: "public, max-age=0, must-revalidate" }),
      launched: false,
    });
    expect(indexCheck(checks)?.ok).toBe(false);
    expect(indexCheck(checks)?.detail).toContain("_headers");
  });

  it("fails when it is missing, and when the home page does not name it", async () => {
    const missing = await runProductionChecks({
      fetchFn: fakeFetch({ indexStatus: 404 }),
      launched: false,
    });
    expect(indexCheck(missing)?.ok).toBe(false);
    const unnamed = await runProductionChecks({
      fetchFn: fakeFetch({ home: `<link rel="canonical" href="${BASE}/">` }),
      launched: false,
    });
    expect(unnamed.find((check) => check.name.includes("names the search index"))?.ok).toBe(false);
  });
});

describe("security and cache headers", () => {
  const failing = (checks: Awaited<ReturnType<typeof runProductionChecks>>) =>
    checks.filter((check) => !check.ok);

  it("pass when every response carries them", async () => {
    const checks = await runProductionChecks({ fetchFn: fakeFetch(), launched: false });
    expect(checks.some((check) => check.name.includes("sends every security header"))).toBe(true);
    expect(failing(checks)).toEqual([]);
  });

  it("fail when a header is missing or has another value, naming it", async () => {
    for (const [name, change] of [
      [
        "Strict-Transport-Security",
        (h: Record<string, string>) => delete h["Strict-Transport-Security"],
      ],
      [
        "Permissions-Policy",
        (h: Record<string, string>) => (h["Permissions-Policy"] = "camera=(self)"),
      ],
      ["X-Content-Type-Options", (h: Record<string, string>) => delete h["X-Content-Type-Options"]],
    ] as const) {
      const checks = await runProductionChecks({
        fetchFn: fakeFetch({ headers: (path, headers) => path === "/tools/" && change(headers) }),
        launched: false,
      });
      const bad = failing(checks);
      expect(
        bad.map((check) => check.name),
        name,
      ).toEqual(["/tools/ sends every security header, and no noindex"]);
      expect(bad[0]?.detail).toContain(name);
    }
  });

  it("fail when the CSP header is not the page's own policy with frame-ancestors", async () => {
    const checks = await runProductionChecks({
      fetchFn: fakeFetch({
        headers: (path, headers) => {
          if (path === "/") headers["content-security-policy"] = "default-src 'none'";
        },
      }),
      launched: false,
    });
    expect(failing(checks).map((check) => check.name)).toEqual([
      "/ sends every security header, and no noindex",
    ]);
  });

  it("fail when a share image cannot be embedded by other sites", async () => {
    const checks = await runProductionChecks({
      fetchFn: fakeFetch({
        headers: (path, headers) => {
          if (path === "/og/home.png") headers["Cross-Origin-Resource-Policy"] = "same-origin";
        },
      }),
      launched: false,
    });
    expect(failing(checks)[0]?.detail).toContain("Cross-Origin-Resource-Policy: same-origin");
  });

  it("fail when production sends noindex", async () => {
    const checks = await runProductionChecks({
      fetchFn: fakeFetch({ headers: (_path, headers) => (headers["x-robots-tag"] = "noindex") }),
      launched: false,
    });
    expect(failing(checks).length).toBeGreaterThan(0);
    expect(failing(checks)[0]?.detail).toContain("production must never send");
  });

  it("fail when pages are cached, or hashed files are not", async () => {
    const pages = await runProductionChecks({
      fetchFn: fakeFetch({
        headers: (path, headers) => {
          if (path === "/") headers["cache-control"] = "public, max-age=3600";
        },
      }),
      launched: false,
    });
    expect(failing(pages).map((check) => check.name)).toEqual(["/ is revalidated on every visit"]);
    const assets = await runProductionChecks({
      fetchFn: fakeFetch({
        headers: (path, headers) => {
          if (path.startsWith("/_astro/")) headers["cache-control"] = HTML_CACHE_CONTROL;
        },
      }),
      launched: false,
    });
    expect(failing(assets).map((check) => check.name)).toEqual([
      "/_astro/SearchDialog.abc123.js is cached for good",
    ]);
  });
});

describe("a preview deployment", () => {
  it("must send noindex on every response, and is not held to the production redirect", async () => {
    const checks = await runProductionChecks({
      fetchFn: fakeFetch({ preview: true, tools: { status: 307, location: "/tools/" } }),
      launched: false,
      preview: true,
    });
    expect(checks.filter((check) => !check.ok)).toEqual([]);
    expect(checks.some((check) => check.name.includes("redirects permanently"))).toBe(false);
    expect(checks.some((check) => check.name.includes("and noindex"))).toBe(true);
  });

  it("fails without noindex", async () => {
    const checks = await runProductionChecks({
      fetchFn: fakeFetch(),
      launched: false,
      preview: true,
    });
    const bad = checks.filter((check) => !check.ok);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0]?.detail).toContain("expected noindex on a preview");
  });
});
