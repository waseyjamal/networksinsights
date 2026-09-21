# 0038. Canonical and meta

Status: Accepted
Date: 2026-09-21

## Context

A search engine that finds the same page at two addresses has to guess which one to show. This site is served from `networksinsights.com` and, before every merge, from a preview address like `pr-11-networksinsights.<account>.workers.dev`, which is public. Without a rule, a preview could become the page that ranks. The same page is also opened by people and by link-preview robots from Slack, X and LinkedIn, which read Open Graph and Twitter/X tags and show whatever image those tags name.

Checked against Google Search Central ("Consolidate duplicate URLs") and the Open Graph protocol: Google recommends absolute URLs in `rel="canonical"`, a self-referencing canonical on the canonical page, and one method (link element or header), not both. It says nothing about trailing slashes, so the choice is ours. Open Graph requires `og:title`, `og:type`, `og:image` and `og:url`. X falls back to the Open Graph tags when its own are missing.

## Decision

**The canonical URL is `https://networksinsights.com` plus the page's route, ending in a slash.** It is built by `lib/seo/urls.ts` from `site.url` and the route path (`Astro.url.pathname`). It never reads the host of the request, so a preview, a local server or any other address names the production page. `pageUrl()` throws on anything that is not a lowercase path that starts and ends with `/`, with no query and no fragment.

**Every page that can be indexed gets** `<link rel="canonical">`, `og:url` and, on a page that has one, structured data. A page that opts out of indexing (the 404 page, `/design-system/`, and a category page with no tool yet, ADR 0040) gets none of the three: it is not a canonical object. It does get the share tags, so a link to it still previews.

**Every page gets** `og:type` (`website`), `og:site_name`, `og:locale`, `og:title`, `og:description`, `og:image` (with `:type`, `:width` 1200, `:height` 630 and `:alt`) and the Twitter/X tags `twitter:card` (`summary_large_image`), `twitter:title`, `twitter:description`, `twitter:image` and `twitter:image:alt`. There is no `twitter:site`: the site has no account, and one is not invented. The canonical renders whether or not `launched` is true, so previews and pre-launch pages already point at production.

**One function builds the tags.** `lib/seo/head.ts` (`buildHead`) turns a title, a description, a path and an image into the tags; `Base.astro` renders them. A page does not write its own.

**Slashless URLs redirect permanently.** Astro is configured with `trailingSlash: "always"` (ADR 0030). Cloudflare's built-in redirect from `/tools` to `/tools/` answers 307 in every `html_handling` mode (documented by Cloudflare), which search engines treat as temporary. The fix is a Single Redirect rule in the Cloudflare dashboard, which is free on the Free plan (10 rules) and costs no Worker request. It is written out in `docs/runbooks/seo-redirects.md`, and `pnpm check:production` proves it exists after every deploy. Rejected: a Worker script in front of every request (every page view would count against the Worker limits and add latency), and a `_redirects` file (a `/:slug /:slug/` rule would also redirect `/favicon.ico`).

**A tool page shows "Updated <date>"** from `manifest.updated`, in the Quick facts (ADR 0044), as `<time datetime="…">`. The date is formatted from the text of the ISO date, never through a time zone, so every machine builds the same page.

## Consequences

- A preview or a mirror cannot outrank the real page. Mission 12 still owes previews an `X-Robots-Tag: noindex` header (launch checklist), because a canonical is a hint and a header is an instruction.
- `check:seo` fails the build on a canonical that is wrong, missing on an indexable page, or present on a noindex page; the unit tests render every page type from three different hosts.
- Google says using both a link element and a header is more error-prone, so the site uses the link element only.

## Revisit when

The site gets a second language (ADR 0023): `hreflang` and one canonical per language are needed then.
