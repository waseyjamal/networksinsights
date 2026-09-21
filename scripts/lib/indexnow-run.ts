// Runs IndexNow for one deploy (ADR 0042). The design has no server and no stored state:
//
//   1. BEFORE the deploy, `snapshot` saves the sitemaps that are live now.
//   2. AFTER the deploy, `submit` compares them with the sitemaps of the new build (`dist`) and
//      announces the URLs that are new or whose `lastmod` changed.
//
// The sitemap is the record of what changed, because its `lastmod` comes from real data. Every
// step that can go wrong is a reason to do nothing, printed plainly, and never a reason to fail
// the deploy: the CI step that runs this is allowed to fail.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { site } from "../../apps/web/src/config/site";
import {
  changedUrls,
  isAccepted,
  isValidKey,
  keyFilePath,
  type SubmitResult,
  submitUrls,
  urlsOfSitemaps,
} from "../../apps/web/src/lib/seo/indexnow";
import { readSitemapIndex } from "../../apps/web/src/lib/seo/sitemap";

/** The text of every sitemap file (not the index) in a folder. */
export function sitemapTexts(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^sitemap-.+\.xml$/.test(name) && name !== "sitemap-index.xml")
    .sort()
    .map((name) => readFileSync(join(dir, name), "utf8"));
}

/** Saves the live sitemaps into `dir`. Returns the files saved; none when the site has no sitemap yet. */
export async function snapshotLive(options: {
  base?: string;
  dir: string;
  fetchFn?: typeof fetch;
}): Promise<string[]> {
  const base = (options.base ?? site.url).replace(/\/$/, "");
  const fetchFn = options.fetchFn ?? fetch;
  mkdirSync(options.dir, { recursive: true });
  const saved: string[] = [];

  const index = await fetchFn(`${base}/sitemap-index.xml`, { redirect: "follow" });
  if (!index.ok) return saved;
  const indexText = await index.text();
  if (!indexText.includes("<sitemapindex")) return saved;
  writeFileSync(join(options.dir, "sitemap-index.xml"), indexText);
  saved.push("sitemap-index.xml");

  for (const loc of readSitemapIndex(indexText)) {
    if (!loc.startsWith(`${site.url}/`)) continue;
    const response = await fetchFn(`${base}${loc.slice(site.url.length)}`, { redirect: "follow" });
    if (!response.ok) continue;
    const name = basename(loc);
    writeFileSync(join(options.dir, name), await response.text());
    saved.push(name);
  }
  return saved;
}

export interface IndexNowOutcome {
  status: "skipped" | "submitted" | "failed";
  /** What happened, in a sentence, for the log. */
  message: string;
  urls: string[];
  results: SubmitResult[];
}

const skipped = (message: string): IndexNowOutcome => ({
  status: "skipped",
  message,
  urls: [],
  results: [],
});

/** Waits until the key file answers with the key, or gives up. The search engines fetch it too. */
async function keyIsLive(
  base: string,
  key: string,
  fetchFn: typeof fetch,
  attempts: number,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchFn(`${base}${keyFilePath(key)}`, { redirect: "follow" });
      if (response.ok && (await response.text()).trim() === key) return true;
    } catch {
      // Try again: a deploy takes a moment to reach every edge.
    }
    if (attempt < attempts) await sleep(5_000);
  }
  return false;
}

export async function submitChanged(options: {
  /** The build output of the deploy that just finished. */
  dist: string;
  /** The sitemaps that were live before it. */
  previousDir: string;
  key: string | undefined;
  launched?: boolean;
  base?: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  keyAttempts?: number;
}): Promise<IndexNowOutcome> {
  const launched = options.launched ?? site.launched;
  const base = (options.base ?? site.url).replace(/\/$/, "");
  const fetchFn = options.fetchFn ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  if (!launched) return skipped("The site is not launched, so nothing is sent to IndexNow.");
  if (!isValidKey(options.key)) {
    return skipped(
      "INDEXNOW_KEY is not set, or is not 8 to 128 letters, digits and dashes, so nothing is sent (docs/runbooks/indexnow.md).",
    );
  }

  const next = urlsOfSitemaps(sitemapTexts(options.dist));
  if (next.length === 0)
    return skipped("The build has no sitemap, so there is nothing to announce.");
  const changed = changedUrls(urlsOfSitemaps(sitemapTexts(options.previousDir)), next);
  if (changed.length === 0) return skipped("No URL is new or changed since the last deploy.");

  if (!(await keyIsLive(base, options.key, fetchFn, options.keyAttempts ?? 6, sleep))) {
    return {
      status: "failed",
      message: `The key file ${base}${keyFilePath(options.key)} is not live, so nothing was sent. The build must have had INDEXNOW_KEY set.`,
      urls: changed,
      results: [],
    };
  }

  const results = await submitUrls(options.key, changed, fetchFn);
  const bad = results.filter((result) => !isAccepted(result.status));
  return bad.length === 0
    ? {
        status: "submitted",
        message: `Sent ${changed.length} ${changed.length === 1 ? "URL" : "URLs"} to IndexNow in ${results.length} ${results.length === 1 ? "request" : "requests"}.`,
        urls: changed,
        results,
      }
    : {
        status: "failed",
        message: `IndexNow refused ${bad.length} of ${results.length} requests (status ${bad.map((result) => result.status).join(", ")}). 403 means the key file does not match the key; 422 means a URL is not on this host; 429 means too many requests.`,
        urls: changed,
        results,
      };
}
