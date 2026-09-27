// Analytics and error reporting (ADR 0051): Umami Cloud, cookie-free, from one small tracker that
// the site serves itself. Everything the privacy page says about analytics is derived from this
// file, so the page and the site cannot disagree.

import { site } from "./site";

// The events and their limits live with the code that sends them, which the browser loads; this
// file imports the site config, which the browser does not need.
export { EVENTS, MAX_ERRORS_PER_PAGE } from "../lib/analytics/events";

/**
 * Where the tracker sends its data. The only third-party origin the Content-Security-Policy names
 * (connect-src, config/headers.ts), and the default host built into the tracker file;
 * analytics.test.ts fails if the two differ.
 */
export const UMAMI_HOST = "https://gateway.umami.is";

/**
 * The tracker is Umami's own script (MIT), copied into lib/analytics/umami-tracker.js so it is
 * served from our origin and `script-src` stays `'self'`. It changes only when a person updates
 * it, following lib/analytics/VENDOR.md; a test pins its hash so a stray edit fails.
 */
export const TRACKER = {
  version: "3.4.0",
  source: "https://cloud.umami.is/script.js",
  sha256: "91a876d767646fd5b7701b6fabf97f8a99ae53b94e7e5b58d465bad1e5d763e0",
} as const;

export interface AnalyticsSettings {
  /** The Umami website id, a UUID. Not a secret: it is in every page. */
  websiteId: string;
  /** The hostnames the tracker runs on. Everywhere else (previews, local runs) it sends nothing. */
  domains: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Analytics are on when the build has `UMAMI_WEBSITE_ID`, a repository variable that only the
 * production deploy passes (docs/launch-checklist.md). Without it the pages carry no analytics
 * script and the privacy page says so. A value that is not a UUID fails the build rather than
 * shipping a tracker that sends nowhere.
 */
export function analyticsSettings(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AnalyticsSettings | undefined {
  const websiteId = env.UMAMI_WEBSITE_ID?.trim();
  if (!websiteId) return undefined;
  if (!UUID.test(websiteId)) {
    throw new Error(
      `UMAMI_WEBSITE_ID must be the website id Umami shows (a UUID), not "${websiteId}". Unset it to build without analytics.`,
    );
  }
  return { websiteId: websiteId.toLowerCase(), domains: site.domain };
}
