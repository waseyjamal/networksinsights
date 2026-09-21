# 0029. Pre-launch noindex flag

Status: Accepted
Date: 2026-09-20

## Context

The site is deployed to production and to per-PR preview URLs (ADR 0027) long before it is ready for visitors. Search engines must not index unfinished pages, and a forgotten "remove noindex" step on launch day is easy to get wrong in either direction: launching with noindex still on, or shipping half-finished pages with it off.

## Decision

One typed config file, `apps/web/src/config/site.ts`, is the single source for the site name, the domain, the tagline ("Free online tools", ADR 0021) and a boolean `launched`, which is `false`.

`apps/web/src/lib/robots.ts` turns the flag into the value of `<meta name="robots">`, and `Base.astro` renders it on every page:

- while `launched` is `false`, every page renders `noindex, nofollow`, whatever the page asks for;
- after launch, a page is indexable unless it opts out with the `noindex` prop (the 404 page and `/design-system`), and those render `noindex`.

Tests enforce it: `robots.test.ts` covers both values of the flag, `Base.test.ts` checks the real config renders `noindex, nofollow`, and the Playwright suite checks every page for a noindex robots meta.

Flipping `launched` to `true` is the launch-day step (Mission 18, `docs/launch-checklist.md`). Nothing else changes.

### Rejected: `robots.txt` with `Disallow: /`

A crawler that is blocked by `robots.txt` never fetches the page, so it never sees the `noindex` meta. A blocked URL can still be indexed (without content) if other sites link to it. `noindex` on a crawlable page is the reliable way to keep a page out of the index, so we do not add a `Disallow`.

## Consequences

- One flag and one function decide indexing. A new page gets the right behavior by using `Base.astro`.
- Until launch the whole site is invisible to search engines, including the production domain.
- **The flag covers preview deployments (workers.dev) only before launch.** Previews are built from the same code, so they inherit the flag. After launch `launched` is `true` everywhere, and PR previews would become indexable. Before launch, preview deployments must therefore send an `X-Robots-Tag: noindex` header of their own. That is Mission 12 (security and headers), and it is listed as a required item in `docs/launch-checklist.md`.
- The meta tag does not cover non-HTML files (images, PDFs). There are none yet.

## Amendment (Mission 10, ADR 0040)

A `robots.txt` now exists, generated from the launch flag. It allows crawling before launch, exactly as this ADR requires, and adds the `Sitemap:` line only after launch. The rejection of `Disallow: /` above stands. The sitemaps and `llms.txt` are not built before launch.

## Revisit when

Non-HTML content is published, or Mission 12 adds response headers (a header could then replace or back up the meta tag).
