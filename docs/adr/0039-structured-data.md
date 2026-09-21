# 0039. Structured data

Status: Accepted
Date: 2026-09-21

## Context

Structured data (JSON-LD) tells search engines what a page is. Google's rule is that it must describe content that is visible on the page. Two things checked on Google Search Central on 2026-09-21 shape this ADR:

- **The FAQ rich result is gone.** Google announced on May 7, 2026 that it no longer shows it, and removed the documentation on June 15, 2026. `FAQPage` is still valid schema.org.
- **The software app rich result needs a rating.** `WebApplication` is an eligible type, but Google requires `aggregateRating` or `review`. This site has no ratings and never invents one (AGENTS.md), so a tool page is valid markup that is not eligible for that rich result.

Google's own guide to generative AI search (May 2026) also says structured data is not required for it and that no special schema.org markup helps.

## Decision

**JSON-LD is generated, never written by hand.** `lib/seo/jsonld.ts` builds typed nodes from the data a page is drawn from, and `Base.astro` writes one `<script type="application/ld+json">` with one `@graph`. The serializer escapes every `<` and both JSON line separators, so no text in a page can end the script element.

| Page | Nodes |
|---|---|
| Home | `Organization` (name, url, logo `/favicon.svg`) and `WebSite` (name, alternateName = the domain, url, description, publisher). No `sameAs`, no `SearchAction`. |
| Every inner page | `BreadcrumbList`. |
| Tool page | `WebApplication` (name, url, description = summary, `applicationCategory`, `operatingSystem: "Any"`, `browserRequirements: "Requires JavaScript"`, free `offers`, `isAccessibleForFree`, `dateModified`, publisher), `FAQPage`, `BreadcrumbList`. |
| `/tools/` and category pages | `CollectionPage` whose `mainEntity` is an `ItemList` of the tools listed, in page order (left out when the page lists none), and `BreadcrumbList`. |
| `/about/`, `/contact/`, `/privacy/`, `/terms/` | `BreadcrumbList`. |

`applicationCategory` comes from a field on each category (`config/categories.ts`), using values from Google's list. A page that opts out of indexing has no structured data.

**Visible and structured data share their source.** A page defines its breadcrumbs once and gives the same list to the visible `<Breadcrumbs>` and to the graph. The FAQ is read from the same `content/en.mdx` the page is rendered from (`faqPairs` in the SDK, which turns Markdown into the text a reader sees). Quick facts (ADR 0044) come from the manifest. schema.org has no property for where a tool runs, its limits or the formats it accepts, so those stay in the visible list only; the price and the date are the two that map (`offers`, `dateModified`).

**Three layers of tests.**
1. Zod schemas (`lib/seo/schemas.ts`) describe every node with no extra keys allowed. A rating, a review or any property nobody meant to add fails.
2. `structuredDataProblems` (`lib/seo/consistency.ts`) checks that every string in a block is text the page shows (title, description, headings, list items, FAQ text, the `<time>` value), that every URL is a link on the page, and that the breadcrumb data is the visible trail. The keys whose value is a constant of the vocabulary are exempt, and each has a fixed value in its schema. It runs in the unit tests on rendered pages, in `pnpm check:seo` on the whole build, and in the Playwright tests against the DOM in a real browser.
3. A negative suite proves the check catches an invented claim, a FAQ answer that is not on the page, a breadcrumb that differs, a rating and a block that does not parse.

## Consequences

- **`FAQPage` is kept** (owner decision) although Google no longer shows it: it is valid, costs nothing, and matches the visible FAQ exactly.
- Tool pages carry no rich-result eligibility until real ratings exist. That is the honest trade.
- A tool's FAQ answers may use links, emphasis and inline code; the structured text is what a reader sees. Tables, images and HTML blocks in an answer are outside what the converter promises, and the browser test on a real tool page is what would catch them (there are none until Mission 13).

## Revisit when

Google or schema.org changes a type this ADR uses, the site gets real ratings, or search is added (`SearchAction` and `WebSite` then).
