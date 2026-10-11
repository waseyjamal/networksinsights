# 0074. Entity data, a Credits page, and tool titles that fit

Status: Accepted
Date: 2026-10-11
Amends: [ADR 0039](0039-structured-data.md) (which page carries which nodes) and the "About page" credits of ADR 0057, 0060, 0061, 0062 and 0064

## Context

The SEO audit of 2026-10-11 (Mission 19) found three things to fix:

- The structured data said little about who runs the site. The `Organization` was written only on the home page, and every tool page wrote its own inline copy as the `publisher`. Nothing named the founder, although the About page does, with links to two profiles.
- `/about/` was about 5,100 words, almost all of them licence text. The few paragraphs that say who runs the site and how it works were lost in it.
- 19 tool titles were 61 to 74 characters long. Google cuts a long title, so the end of the title was lost on those 19 pages.

## Decision

**Entity data.**

- The organization has one id, `https://networksinsights.com/#organization`, and is written in full only on the home page. It now names its founder by id: `founder: {"@id": "https://networksinsights.com/#founder"}`.
- The founder is a `Person` with that id, written on `/about/`, the page that introduces them. It has the name and a `sameAs` with exactly the two profiles the page links to (GitHub and LinkedIn), taken from `owner` in `config/site.ts`. The page reads the same config, so the two cannot disagree. Nothing else about the person is written: no job title, no city, no email.
- `/about/` carries an `AboutPage` whose `about` is the organization's id.
- A tool's `WebApplication` names its `publisher` by the organization's id instead of an inline copy. The `WebSite` already did.
- The organization has no `sameAs`. The two profiles are the founder's, and a person's profile is not the organization; the site has no profile of its own.
- `schemas.ts` holds every id to its exact value, allows only these two profile URLs in `sameAs`, and allows no other property. The consistency check (ADR 0039) now accepts an outside URL only when the page links to it, as it already did for the site's own URLs.

**Credits.** The open-source credits, with every notice and licence in full, move from `/about/` to `/credits/` ("Open-source credits"), an indexable page in the pages sitemap with its own title, description, canonical link and breadcrumb. The footer and `/about/` link to it, and llms.txt lists it. Everything ADR 0057, 0060, 0061, 0062 and 0064 say about "the About page credits" now applies to `/credits/`; `site.spec.ts` checks the notices there. `/about/` keeps what the site is, how files are processed, how the tools are built and tested, where things stand and who runs it, all written from the repository and the privacy page.

**Tool titles.** `toolTitle` keeps "<Name> — Free online tool | NetworksInsights" when it is at most 60 characters. A longer one becomes "<Name> — Free online | NetworksInsights", then "<Name> | NetworksInsights", stopping at the first that fits. A title that fits is never shortened. `pnpm check:seo` fails a tool page whose title is over 60 characters (entities counted as the one character they show).

## Consequences

- Structured data per page: the home page carries `Organization` and `WebSite`; `/about/` carries `AboutPage`, `Person` and `BreadcrumbList`; `/credits/`, `/contact/`, `/privacy/` and `/terms/` carry `BreadcrumbList`. The rest of ADR 0039's table stands.
- A tool name longer than 41 characters would fail `check:seo` even with the shortest title. No tool name is that long today; one that is must be shortened.
