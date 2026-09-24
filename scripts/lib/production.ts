// `pnpm check:production`: does the live site behave the way the SEO work assumes? (ADR 0038,
// ADR 0040, docs/runbooks/seo-redirects.md.) It makes real requests, so it takes a `fetch`, and
// the tests give it a fake one.
//
// The most important check is the redirect: a request for /tools must be answered with a
// permanent redirect (301 or 308) to /tools/. Cloudflare's own trailing-slash redirect is a 307,
// which search engines treat as temporary, so a dashboard rule has to replace it, and nothing else
// can prove that rule exists.

import { site } from "../../apps/web/src/config/site";

export interface ProductionOptions {
  /** The site to check. Defaults to the production domain. */
  base?: string;
  /** Whether the site is launched (config/site.ts). Decides what robots.txt must say. */
  launched?: boolean;
  fetchFn?: typeof fetch;
}

export interface Check {
  name: string;
  ok: boolean;
  /** What was seen, so a failure says what to fix. */
  detail: string;
}

const PERMANENT = new Set([301, 308]);

/** A request that never follows a redirect, so the redirect itself can be read. */
const get = (fetchFn: typeof fetch, url: string) =>
  fetchFn(url, {
    redirect: "manual",
    headers: { "user-agent": "networksinsights-post-deploy-check" },
  });

export async function runProductionChecks(options: ProductionOptions = {}): Promise<Check[]> {
  const base = (options.base ?? site.url).replace(/\/$/, "");
  const launched = options.launched ?? site.launched;
  const fetchFn = options.fetchFn ?? fetch;
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  // 1. The slashless URL redirects permanently to the slash URL.
  const slashless = await get(fetchFn, `${base}/tools`);
  const location = slashless.headers.get("location") ?? "";
  const target = location.startsWith("/") ? `${base}${location}` : location;
  add(
    "/tools redirects permanently to /tools/",
    PERMANENT.has(slashless.status) && target === `${base}/tools/`,
    `answered ${slashless.status}${location ? ` with Location: ${location}` : " with no Location"}. Expected 301 or 308 to ${base}/tools/. A 307 is Cloudflare's built-in redirect: create the rule in docs/runbooks/seo-redirects.md.`,
  );

  // 2. The redirect leaves everything that should not redirect alone.
  for (const path of ["/", "/tools/", "/favicon.ico", "/robots.txt"]) {
    const response = await get(fetchFn, `${base}${path}`);
    add(
      `${path} answers 200 with no redirect`,
      response.status === 200,
      `answered ${response.status}`,
    );
  }

  // 3. An unknown page is a real 404, with the noindex page.
  const missing = await get(fetchFn, `${base}/this-page-does-not-exist/`);
  add("an unknown page answers 404", missing.status === 404, `answered ${missing.status}`);

  // 4. robots.txt says what the launch flag says.
  const robots = await (await get(fetchFn, `${base}/robots.txt`)).text();
  const advertises = /^Sitemap:\s*https:\/\/networksinsights\.com\/sitemap-index\.xml\s*$/im.test(
    robots,
  );
  add(
    `robots.txt ${launched ? "names the sitemap" : "does not advertise a sitemap"}`,
    advertises === launched,
    launched ? "no Sitemap line" : "a Sitemap line is there before launch",
  );

  // 5. The home page names the production domain as its canonical, whatever host was asked.
  const home = await (await get(fetchFn, `${base}/`)).text();
  const canonical = /<link rel="canonical" href="([^"]*)"/.exec(home)?.[1];
  add(
    "the home page's canonical is the production home page",
    canonical === `${site.url}/`,
    `canonical is ${canonical ?? "missing"}`,
  );

  // 6. The search index (ADR 0045): the home page names it, it answers, and it is cached for good.
  // Its name carries a hash of its content, so `immutable` is safe; without the header every visit
  // to search would revalidate a file that cannot have changed. The header comes from
  // apps/web/public/_headers, which only Cloudflare reads, so only a live request can prove it.
  const indexPath = /\bdata-index="(\/search-index\.[0-9a-f]+\.json)"/.exec(home)?.[1];
  if (indexPath === undefined) {
    add(
      "the home page names the search index",
      false,
      "no data-index=/search-index.<hash>.json on the page; SearchDialog.astro must be rendered on every page",
    );
  } else {
    const response = await get(fetchFn, `${base}${indexPath}`);
    const cache = response.headers.get("cache-control") ?? "";
    add(
      `${indexPath} is served and cached for good`,
      response.status === 200 && /\bimmutable\b/.test(cache) && /\bmax-age=\d{7,}\b/.test(cache),
      `answered ${response.status} with Cache-Control: ${cache || "(none)"}. Expected 200 and "public, max-age=31536000, immutable": check apps/web/public/_headers.`,
    );
  }

  // 7. After launch the sitemap index and llms.txt exist.
  if (launched) {
    for (const path of ["/sitemap-index.xml", "/llms.txt"]) {
      const response = await get(fetchFn, `${base}${path}`);
      add(`${path} answers 200`, response.status === 200, `answered ${response.status}`);
    }
  }
  return checks;
}

/** Runs the checks until they pass, or until `attempts` are used up, waiting between them. */
export async function runWithRetries(
  options: ProductionOptions & {
    attempts?: number;
    waitMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<Check[]> {
  const attempts = options.attempts ?? 1;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let checks: Check[] = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    checks = await runProductionChecks(options);
    if (checks.every((check) => check.ok) || attempt === attempts) return checks;
    await sleep(options.waitMs ?? 10_000);
  }
  return checks;
}

export function formatChecks(checks: readonly Check[], base: string): string {
  const lines = checks.map(
    (check) =>
      `  ${check.ok ? "✓" : "✗"} ${check.name}${check.ok ? "" : `\n      ${check.detail}`}`,
  );
  const failed = checks.filter((check) => !check.ok).length;
  return `Production check of ${base}\n\n${lines.join("\n")}\n\n${failed === 0 ? "All checks pass." : `${failed} ${failed === 1 ? "check" : "checks"} failed.`}`;
}
