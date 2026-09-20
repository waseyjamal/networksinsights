// The single source for who the site is. Nothing else may hard-code the name, the domain or
// the tagline (ADR 0021), and nothing else may decide whether the site is launched (ADR 0029).

export const site = {
  name: "NetworksInsights",
  domain: "networksinsights.com",
  url: "https://networksinsights.com",
  tagline: "Free online tools",
  /**
   * False until launch day. While false, every page renders `noindex, nofollow`. Flipping it to
   * true is the launch step in docs/launch-checklist.md (Mission 18): do not change it before.
   */
  launched: false,
} as const;

/** "<Page> | NetworksInsights": the title of every page except the home page. */
export function pageTitle(page: string): string {
  return `${page} | ${site.name}`;
}

/** The home page title: "NetworksInsights — Free online tools". */
export const homeTitle = `${site.name} — ${site.tagline}`;

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
  "privacy",
  "terms",
  "tools",
] as const;

/** The site-level pages linked from the header menu and the footer. Paths end in a slash. */
export const sitePages = {
  tools: { label: "All tools", href: "/tools/" },
  about: { label: "About", href: "/about/" },
  contact: { label: "Contact", href: "/contact/" },
  privacy: { label: "Privacy", href: "/privacy/" },
  terms: { label: "Terms", href: "/terms/" },
} as const;
