import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSitemapFiles,
  renderSitemapIndex,
  renderUrlset,
} from "../apps/web/src/lib/seo/sitemap";
import { toolOf } from "../apps/web/src/lib/seo/test-tools";
import { sitemapTexts, snapshotLive, submitChanged } from "./lib/indexnow-run";
import { scratchRoot } from "./lib/test-support";

// The IndexNow runner (ADR 0042): a snapshot of the live sitemaps before a deploy, and after it a
// submission of the URLs that changed. Every test uses a pretend site and a pretend IndexNow.

const KEY = "0123456789abcdef0123456789abcdef";
const SITE = "https://networksinsights.com";
const roots: Array<ReturnType<typeof scratchRoot>> = [];
afterEach(() => {
  for (const scratch of roots.splice(0)) scratch.remove();
});
const fresh = () => {
  const scratch = scratchRoot();
  roots.push(scratch);
  return scratch.root;
};

/** Writes the sitemaps of a set of tools into a folder, the way the build does. */
function writeSitemaps(dir: string, tools: ReturnType<typeof toolOf>[]) {
  mkdirSync(dir, { recursive: true });
  const files = buildSitemapFiles(tools);
  for (const file of files)
    writeFileSync(join(dir, `sitemap-${file.slug}.xml`), renderUrlset(file.entries));
  writeFileSync(join(dir, "sitemap-index.xml"), renderSitemapIndex(files));
  return files;
}

interface Site {
  /** The sitemap files live on the pretend site, by path. */
  files?: Record<string, string>;
  keyBody?: string | undefined;
  indexNowStatus?: number;
}

function fakeFetch(site: Site = {}) {
  const posts: Array<{ url: string; body: { urlList: string[]; key: string; host: string } }> = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === "POST") {
      posts.push({ url: String(input), body: JSON.parse(String(init.body)) });
      return new Response(null, { status: site.indexNowStatus ?? 202 });
    }
    if (url.pathname === `/${KEY}.txt`) {
      return site.keyBody === undefined
        ? new Response("no", { status: 404 })
        : new Response(site.keyBody);
    }
    const body = site.files?.[url.pathname];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, posts, calls: fetchFn };
}

const noSleep = async () => {};

describe("snapshot", () => {
  it("saves the sitemap index and every sitemap it lists", async () => {
    const live = fresh();
    const built = writeSitemaps(join(live, "built"), [toolOf("word-counter")]);
    const files: Record<string, string> = { "/sitemap-index.xml": renderSitemapIndex(built) };
    for (const file of built) files[`/sitemap-${file.slug}.xml`] = renderUrlset(file.entries);
    const dir = join(live, "snapshot");
    const saved = await snapshotLive({ dir, fetchFn: fakeFetch({ files }).fetchFn });
    expect(saved.sort()).toEqual([
      "sitemap-categories.xml",
      "sitemap-index.xml",
      "sitemap-pages.xml",
      "sitemap-tools.xml",
    ]);
    expect(readdirSync(dir).sort()).toEqual(saved.sort());
    expect(sitemapTexts(dir)).toHaveLength(3);
  });

  it("saves nothing, and does not fail, when the live site has no sitemap yet", async () => {
    const dir = join(fresh(), "snapshot");
    expect(await snapshotLive({ dir, fetchFn: fakeFetch().fetchFn })).toEqual([]);
    expect(sitemapTexts(dir)).toEqual([]);
  });

  it("ignores a 200 that is not a sitemap, such as a custom error page", async () => {
    const dir = join(fresh(), "snapshot");
    const files = { "/sitemap-index.xml": "<html>Page not found</html>" };
    expect(await snapshotLive({ dir, fetchFn: fakeFetch({ files }).fetchFn })).toEqual([]);
  });
});

describe("submit: when it does nothing", () => {
  const dist = () => {
    const dir = join(fresh(), "dist");
    writeSitemaps(dir, [toolOf("word-counter")]);
    return dir;
  };

  it("does nothing before launch, and never touches the network", async () => {
    const { fetchFn, calls } = fakeFetch({ keyBody: KEY });
    const outcome = await submitChanged({
      dist: dist(),
      previousDir: fresh(),
      key: KEY,
      launched: false,
      fetchFn,
    });
    expect(outcome.status).toBe("skipped");
    expect(outcome.message).toContain("not launched");
    expect(calls).not.toHaveBeenCalled();
  });

  it("does nothing without a valid key, and says how to set one", async () => {
    for (const key of [undefined, "", "short", "has spaces in it", "../../x"]) {
      const { fetchFn, calls } = fakeFetch({ keyBody: KEY });
      const outcome = await submitChanged({
        dist: dist(),
        previousDir: fresh(),
        key,
        launched: true,
        fetchFn,
      });
      expect(outcome.status, String(key)).toBe("skipped");
      expect(outcome.message).toContain("INDEXNOW_KEY");
      expect(calls).not.toHaveBeenCalled();
    }
  });

  it("does nothing when the build has no sitemap", async () => {
    const outcome = await submitChanged({
      dist: fresh(),
      previousDir: fresh(),
      key: KEY,
      launched: true,
      fetchFn: fakeFetch().fetchFn,
    });
    expect(outcome.status).toBe("skipped");
    expect(outcome.message).toContain("no sitemap");
  });

  it("does nothing when nothing changed since the snapshot", async () => {
    const built = fresh();
    writeSitemaps(join(built, "a"), [toolOf("word-counter", "text", "2026-09-19")]);
    writeSitemaps(join(built, "b"), [toolOf("word-counter", "text", "2026-09-19")]);
    const { fetchFn, posts } = fakeFetch({ keyBody: KEY });
    const outcome = await submitChanged({
      dist: join(built, "a"),
      previousDir: join(built, "b"),
      key: KEY,
      launched: true,
      fetchFn,
    });
    expect(outcome.status).toBe("skipped");
    expect(outcome.message).toContain("No URL is new or changed");
    expect(posts).toEqual([]);
  });
});

describe("submit: when it sends", () => {
  it("sends only the URLs that are new or changed", async () => {
    const root = fresh();
    writeSitemaps(join(root, "before"), [
      toolOf("word-counter", "text", "2026-09-19"),
      toolOf("case-converter", "text", "2026-09-19"),
    ]);
    writeSitemaps(join(root, "after"), [
      toolOf("word-counter", "text", "2026-09-19"), // unchanged
      toolOf("case-converter", "text", "2026-09-25"), // changed
      toolOf("merge-pdf", "pdf", "2026-09-25"), // new
    ]);
    const { fetchFn, posts } = fakeFetch({ keyBody: `${KEY}\n` });
    const outcome = await submitChanged({
      dist: join(root, "after"),
      previousDir: join(root, "before"),
      key: KEY,
      launched: true,
      fetchFn,
      sleep: noSleep,
    });
    expect(outcome.status).toBe("submitted");
    expect(posts).toHaveLength(1);
    const sent = posts[0]?.body.urlList ?? [];
    expect(sent).toContain(`${SITE}/case-converter/`);
    expect(sent).toContain(`${SITE}/merge-pdf/`);
    expect(sent).toContain(`${SITE}/pdf-tools/`);
    expect(sent).not.toContain(`${SITE}/word-counter/`);
    expect(sent).not.toContain(`${SITE}/about/`);
    expect(posts[0]?.body.key).toBe(KEY);
    expect(posts[0]?.body.host).toBe("networksinsights.com");
    expect(posts[0]?.url).toBe("https://api.indexnow.org/indexnow");
  });

  it("sends every URL on the first deploy, when there was no sitemap before", async () => {
    const root = fresh();
    writeSitemaps(join(root, "after"), [toolOf("word-counter")]);
    const { fetchFn, posts } = fakeFetch({ keyBody: KEY });
    const outcome = await submitChanged({
      dist: join(root, "after"),
      previousDir: join(root, "none"),
      key: KEY,
      launched: true,
      fetchFn,
      sleep: noSleep,
    });
    expect(outcome.status).toBe("submitted");
    expect(posts[0]?.body.urlList).toContain(`${SITE}/`);
    expect(posts[0]?.body.urlList).toContain(`${SITE}/word-counter/`);
  });

  it("checks the key file is live first, and sends nothing when it is not", async () => {
    const root = fresh();
    writeSitemaps(join(root, "after"), [toolOf("word-counter")]);
    const { fetchFn, posts, calls } = fakeFetch({ keyBody: undefined });
    const sleeps: number[] = [];
    const outcome = await submitChanged({
      dist: join(root, "after"),
      previousDir: join(root, "none"),
      key: KEY,
      launched: true,
      fetchFn,
      keyAttempts: 3,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.message).toContain("not live");
    expect(posts).toEqual([]);
    expect(calls.mock.calls.filter(([url]) => String(url).endsWith(`/${KEY}.txt`))).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
  });

  it("does not send when the key file holds another key", async () => {
    const root = fresh();
    writeSitemaps(join(root, "after"), [toolOf("word-counter")]);
    const { fetchFn, posts } = fakeFetch({ keyBody: "some-other-key-entirely-1234" });
    const outcome = await submitChanged({
      dist: join(root, "after"),
      previousDir: join(root, "none"),
      key: KEY,
      launched: true,
      fetchFn,
      keyAttempts: 1,
      sleep: noSleep,
    });
    expect(outcome.status).toBe("failed");
    expect(posts).toEqual([]);
  });

  it("reports a refusal with what each status means", async () => {
    const root = fresh();
    writeSitemaps(join(root, "after"), [toolOf("word-counter")]);
    const { fetchFn } = fakeFetch({ keyBody: KEY, indexNowStatus: 403 });
    const outcome = await submitChanged({
      dist: join(root, "after"),
      previousDir: join(root, "none"),
      key: KEY,
      launched: true,
      fetchFn,
      sleep: noSleep,
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.message).toContain("status 403");
    expect(outcome.message).toContain("does not match the key");
  });
});
