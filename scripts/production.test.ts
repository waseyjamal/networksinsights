import { describe, expect, it, vi } from "vitest";
import { formatChecks, runProductionChecks, runWithRetries } from "./lib/production";

// `pnpm check:production` against a pretend site. The important case is the redirect: a 307 (what
// Cloudflare sends by itself) must fail, and a 301 or 308 must pass.

const BASE = "https://networksinsights.com";
const home = `<html><head><link rel="canonical" href="${BASE}/"></head></html>`;

interface Fake {
  tools?: { status: number; location?: string };
  robots?: string;
  home?: string;
  favicon?: number;
  missing?: number;
  launched?: boolean;
}

/** A fetch that answers like the site does, with the parts a test wants to change. */
function fakeFetch(fake: Fake = {}): typeof fetch {
  const robots = fake.robots ?? "User-agent: *\nAllow: /\n";
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const respond = (status: number, body = "", headers: Record<string, string> = {}) =>
      new Response(status === 301 || status === 307 || status === 308 ? null : body, {
        status,
        headers,
      });
    if (path === "/tools") {
      const tools = fake.tools ?? { status: 301, location: "/tools/" };
      return respond(tools.status, "", tools.location ? { location: tools.location } : {});
    }
    if (path === "/") return respond(200, fake.home ?? home);
    if (path === "/tools/") return respond(200, "<html></html>");
    if (path === "/favicon.ico") return respond(fake.favicon ?? 200, "x");
    if (path === "/robots.txt") return respond(200, robots);
    if (path === "/sitemap-index.xml" || path === "/llms.txt") return respond(200, "x");
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
