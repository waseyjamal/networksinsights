// The header half of `pnpm check:production` (ADR 0047, ADR 0048): what Cloudflare really sends,
// on the live site after a deploy or on a preview deployment before merge. The expected values come
// from apps/web/src/config/headers.ts, the same file that wrote dist/_headers, so the build and this
// check cannot disagree about what is right.

import {
  embeddablePaths,
  HTML_CACHE_CONTROL,
  IMMUTABLE,
  previewHeaders,
  securityHeaders,
} from "../../apps/web/src/config/headers";
import { headerPolicy, readPage } from "../../apps/web/src/lib/security/headers-file";
import type { Check } from "./production";

export interface HeaderCheckOptions {
  base: string;
  /** A preview deployment on workers.dev: it must send noindex. Production must not. */
  preview: boolean;
  /** The home page's HTML, already fetched. */
  home: string;
  get: (url: string) => Promise<Response>;
}

const isEmbeddable = (path: string) =>
  embeddablePaths.some((pattern) =>
    pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : path === pattern,
  );

/** The policy the header must carry: the home page's own <meta> policy plus frame-ancestors. */
function expectedPolicy(home: string): string | undefined {
  try {
    const policy = readPage("/", home).policy;
    return policy === undefined ? undefined : headerPolicy(policy);
  } catch {
    return undefined;
  }
}

export async function headerChecks(options: HeaderCheckOptions): Promise<Check[]> {
  const { base, preview, home, get } = options;
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const policy = expectedPolicy(home);
  add(
    "the home page carries its Content-Security-Policy <meta>",
    policy !== undefined,
    "no CSP <meta> on the home page: is security.csp still on in astro.config.mjs?",
  );

  const script = /<script type="module" src="(\/_astro\/[^"]+\.js)"/.exec(home)?.[1];
  const paths = [
    "/",
    "/tools/",
    "/this-page-does-not-exist/",
    "/robots.txt",
    "/favicon.ico",
    "/og/home.png",
    ...(script ? [script] : []),
  ];

  for (const path of paths) {
    const response = await get(`${base}${path}`);
    const wrong: string[] = [];
    for (const [name, value] of Object.entries(securityHeaders)) {
      const expected =
        name === "Cross-Origin-Resource-Policy" && isEmbeddable(path) ? "cross-origin" : value;
      const actual = response.headers.get(name);
      if (actual !== expected)
        wrong.push(`${name}: ${actual ?? "(missing)"}, expected ${expected}`);
    }
    const csp = response.headers.get("content-security-policy");
    if (policy !== undefined && csp !== policy) {
      wrong.push(
        `Content-Security-Policy: ${csp ?? "(missing)"}, expected the home page's policy with frame-ancestors 'none'`,
      );
    }
    const robots = response.headers.get("x-robots-tag");
    const expectedRobots = preview ? previewHeaders["X-Robots-Tag"] : null;
    if (robots !== expectedRobots) {
      wrong.push(
        preview
          ? `X-Robots-Tag: ${robots ?? "(missing)"}, expected ${expectedRobots} on a preview`
          : `X-Robots-Tag: ${robots}, which production must never send`,
      );
    }
    add(
      `${path} sends every security header${preview ? " and noindex" : ", and no noindex"}`,
      wrong.length === 0,
      `answered ${response.status}. ${wrong.join("; ")}. The headers come from dist/_headers (apps/web/src/config/headers.ts).`,
    );
  }

  // Cache headers: pages always revalidate, hashed files are kept for a year.
  for (const path of ["/", "/tools/"]) {
    const cache = (await get(`${base}${path}`)).headers.get("cache-control");
    add(
      `${path} is revalidated on every visit`,
      cache === HTML_CACHE_CONTROL,
      `Cache-Control: ${cache ?? "(none)"}, expected ${HTML_CACHE_CONTROL}`,
    );
  }
  if (script === undefined) {
    add(
      "the home page loads a hashed script from /_astro/",
      false,
      "no /_astro/ module script found",
    );
  } else {
    const cache = (await get(`${base}${script}`)).headers.get("cache-control");
    add(
      `${script} is cached for good`,
      cache === IMMUTABLE,
      `Cache-Control: ${cache ?? "(none)"}, expected ${IMMUTABLE}`,
    );
  }
  return checks;
}
