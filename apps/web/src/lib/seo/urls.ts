// Absolute URLs on the production domain (ADR 0038).
//
// Every canonical link, Open Graph URL, sitemap entry and structured-data URL comes from here,
// and every one of them is built from `site.url`. **Nothing reads the address of the request.**
// A preview deployment on `pr-7-….workers.dev` therefore names `https://networksinsights.com`,
// so a preview can never become the canonical version of a page.

import { site } from "../../config/site";

/**
 * The absolute URL of a page. A page path starts and ends with a slash (ADR 0030), and has no
 * query or fragment: `/`, `/tools/`, `/word-counter/`. Anything else throws, because a canonical
 * that is wrong only shows up as a ranking problem months later.
 */
export function pageUrl(path: string): string {
  if (!/^\/(?:[a-z0-9][a-z0-9-]*\/)*$/.test(path)) {
    throw new Error(
      `Not a page path: ${JSON.stringify(path)}. A page path starts and ends with "/" and holds lowercase words joined by hyphens, like "/tools/".`,
    );
  }
  return `${site.url}${path}`;
}

/**
 * The absolute URL of a file: `/og/word-counter.png`, `/favicon.svg`, `/sitemap-index.xml`. A file
 * path starts with a slash and ends in a file name with an extension.
 */
export function fileUrl(path: string): string {
  if (!/^\/(?:[a-z0-9][a-z0-9-]*\/)*[a-z0-9][a-z0-9.-]*\.[a-z0-9]+$/.test(path)) {
    throw new Error(`Not a file path: ${JSON.stringify(path)}. Example: "/og/word-counter.png".`);
  }
  return `${site.url}${path}`;
}

/** The path of a URL on this site, or undefined when it is on another host. */
export function pathOfSiteUrl(url: string): string | undefined {
  const parsed = new URL(url);
  return parsed.origin === site.url ? parsed.pathname : undefined;
}
