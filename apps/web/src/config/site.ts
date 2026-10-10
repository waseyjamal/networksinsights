// The single source for who the site is. Nothing else may hard-code the name, the domain or
// the tagline (ADR 0021), and nothing else may decide whether the site is launched (ADR 0029).

export const site = {
  name: "NetworksInsights",
  domain: "networksinsights.com",
  url: "https://networksinsights.com",
  tagline: "Free online tools",
  /** What the site is, in one sentence: the home page's meta description and the llms.txt summary. */
  description:
    "Convert, compress, calculate and create right in your browser. Free online tools with no sign-up, private by design.",
  /**
   * False until launch day. While false, every page renders `noindex, nofollow`. Flipping it to
   * true is the launch step in docs/launch-checklist.md (Mission 18): do not change it before.
   */
  launched: false,
} as const;

/** The words at the top of the home page. The home page and its share image both use them. */
export const homeHero = {
  headline: "Free online tools. Private by design.",
  lead: "Convert, compress, calculate and create right in your browser. No sign-up needed.",
} as const;

/** "<Page> | NetworksInsights": the title of every page except the home page. */
export function pageTitle(page: string): string {
  return `${page} | ${site.name}`;
}

/** The home page title: "NetworksInsights — Free online tools". */
export const homeTitle = `${site.name} — ${site.tagline}`;

/** "<Tool name> — Free online tool | NetworksInsights": the title of every tool page. */
export function toolTitle(name: string): string {
  return pageTitle(`${name} — Free online tool`);
}

/**
 * URL segments of the pages that are not generated from a config, one per file in
 * src/pages. site.test.ts fails if this list and that folder disagree, so a new page cannot
 * be added without also reserving its path.
 */
export const staticPagePaths = [
  "404",
  "about",
  "contact",
  "design-system",
  "offline",
  "privacy",
  "terms",
  "tools",
] as const;

/**
 * The date each page without a tool behind it last changed in a way a reader or a search engine
 * would notice (its wording, its structured data or its links), as `YYYY-MM-DD`. It is the
 * `lastmod` of the page in the sitemap (ADR 0040). Google only trusts a `lastmod` that is
 * accurate, and it ignores cosmetic changes, so this is kept by hand and never read from git,
 * where a shallow CI checkout would date every file the same and a layout change would date every
 * page as modified. When you change what one of these pages says, change its date here:
 * `sitemap.test.ts` fails on a full clone if the page's file changed in git after its date.
 *
 * `home` and `tools` are the newest of this date and the `updated` date of every tool, and a
 * category page is the newest of `categoriesUpdated` and the `updated` date of its tools.
 */
export const pageUpdated = {
  home: "2026-09-21",
  tools: "2026-09-21",
  about: "2026-10-10",
  contact: "2026-10-10",
  privacy: "2026-10-10",
  terms: "2026-10-10",
} as const;

/** The site-level pages linked from the header menu and the footer. Paths end in a slash. */
export const sitePages = {
  tools: { label: "All tools", href: "/tools/" },
  about: { label: "About", href: "/about/" },
  contact: { label: "Contact", href: "/contact/" },
  privacy: { label: "Privacy", href: "/privacy/" },
  terms: { label: "Terms", href: "/terms/" },
} as const;
