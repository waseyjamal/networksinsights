# 0040. Crawling, robots and AI crawlers

Status: Accepted
Date: 2026-09-21

## Context

Search engines and AI systems find pages through `robots.txt`, sitemaps and (for some assistants) `llms.txt`. ADR 0029 decided that before launch the site is crawlable but every page is `noindex`, because a crawler blocked by `robots.txt` never reads the `noindex` tag. This ADR builds the files that ADR needs and decides who may collect pages for what.

Checked on the official pages on 2026-09-21: Google says `lastmod` is used only when it is consistently accurate and that it ignores `priority` and `changefreq`; one sitemap holds at most 50,000 URLs or 50 MB. Google's own guide says Search ignores `llms.txt`. `Google-Extended` is a robots token with no user agent of its own and does not affect Search; `Applebot-Extended` does not crawl and does not affect Apple search. Each AI operator documents separate crawlers for search, for fetches a person asked for, and for training (OpenAI, Anthropic, Perplexity, Meta, Amazon, Apple, Google).

## Decision

**robots.txt is generated** (`pages/robots.txt.ts`, from `config/crawlers.ts` and the launch flag), and always exists.
- Before launch (`launched = false`): `User-agent: *` / `Allow: /`, the crawler groups, and **no `Sitemap:` line**.
- After launch: the same, plus `Sitemap: https://networksinsights.com/sitemap-index.xml`.

**One list of crawlers** in `config/crawlers.ts`: token, operator, purpose (`search`, `user`, `training` or `preview`) and the operator's own page that documents it. A crawler that its operator does not document is not listed. Search, assistant and preview crawlers are always allowed: `Googlebot`, `bingbot`, `DuckDuckBot`, `Applebot`, `OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`, `meta-webindexer`, `ChatGPT-User`, `Claude-User`, `Perplexity-User`, `meta-externalfetcher`, `facebookexternalhit`.

**Training crawlers are allowed: `trainingPolicy = "allow"`.** This is the owner's decision. Reasoning: the owner prioritises being answered by AI assistants (AEO); the site's value is its working tools, which a model cannot copy by reading the pages; and being present in what models know is worth more than withholding pages that hold little a model could not already learn. The list is `GPTBot`, `ClaudeBot`, `Google-Extended`, `Applebot-Extended`, `meta-externalagent`, `CCBot` and `Amazonbot`. Changing the one constant to `"disallow"` asks all of them to stay away (tested). Things to know when revisiting it:
- `robots.txt` is a request, not a lock. `Perplexity-User` and `meta-externalfetcher` say they may ignore it for a fetch a person asked for.
- Blocking would not remove the site from Search: Google and Apple both say so in their own documentation.
- `Amazonbot` is one token for product use and training, so it follows the training policy.
- Before launch these crawlers may read unfinished pages. Every page is `noindex`, and a training crawler is not obliged to honour that; nothing links to the site yet.

**Sitemaps:** an index (`/sitemap-index.xml`) and separate files for the pages, the categories and the tools (`/sitemap-pages.xml`, `/sitemap-categories.xml`, `/sitemap-tools.xml`, then `-2`, `-3` past 50,000 URLs). One route serves them all. **They are not built before launch**: every page is noindex then, and an empty `urlset` is not valid. Only indexable pages are listed, never a noindex page, the 404 page or `/design-system/`. `pnpm check:seo` fails a sitemap that lists a noindex page, a page that was not built, or a page that lacks a canonical, and an indexable page that is in no sitemap.

**A category page with no tool is `noindex` and left out of the sitemaps and `llms.txt`** until it has one (owner decision). A "coming soon" page is not worth a search result. It has no canonical and no structured data, and keeps its share card.

**`lastmod` comes from real data.** A tool: its `updated` date. A category: the newest of its tools' dates and `categoriesUpdated`. The home page and `/tools/`: the newest of their own date and every tool's. The static pages: dates kept by hand in `config/site.ts` (`pageUpdated`). Not git dates: CI uses a shallow checkout, which dates every file the same, and a layout change would date every page as modified. On a full clone (the pre-push run) a test fails if a static page's file changed in git after its date, so a wording change cannot keep an old date; on a shallow clone it is skipped. Google counts structured data and links as significant changes, so changing them means changing the date.

**llms.txt** is generated from the registry in the llmstxt.org format (site name, summary, a Categories list, a Tools list, an Optional list of site pages) and, like the sitemaps, is not built before launch. It is a cheap hedge: Google says Search ignores it.

## Consequences

- Nothing about the site is advertised to crawlers before launch except that it may be crawled.
- Adding a crawler is a one-line change with a source; a test rejects duplicate tokens and entries with no source.
- Static page dates must be bumped by hand when their wording changes (`docs/launch-checklist.md`).
- The 1,000-tool sitemap is one file well under the limits (tested at 1,000 and, split, at 120 with a limit of 50).

## Revisit when

Search engines change how they treat AI crawlers, the owner wants to withhold training, or a page type appears that should not be indexed.
