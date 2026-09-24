# 0045. Search index and engine

Status: Accepted
Date: 2026-09-22

## Context

The site starts at 500+ tools and grows without limit, so a visitor finds a tool by typing, not by browsing. Search has to be instant (a result for every keystroke), forgiving (typos, half-typed words, "jpg to png"), private (a query never leaves the device) and small (the site's rule is static HTML first, ADR 0002). Mission 11 needs three things: a file that describes every tool, an engine that answers over it, and a way to show a match without ever turning a tool's words into markup.

The production site ships zero tools until Mission 13, so everything here is built and measured on synthetic tools that exist only in tests.

## Decision

### A. The index

`buildSearchIndex()` (`apps/web/src/lib/search/index-build.ts`) turns the registry into `{ "version": 1, "tools": [...] }`. Each record is `id`, `name`, `summary`, `category`, `tags`, `accepts`, `produces` and `href`, exactly as the manifest says: nothing added, nothing rewritten. `accepts` and `produces` are left out when the manifest has none. Records are sorted by id, so the same tools always give the same bytes.

**Which tools.** A tool is searchable when its status is not `deprecated`. That is the same rule the page itself uses to decide it is `noindex` (`ToolPage.astro`), so search never sends a visitor to a page that asks search engines not to list it. The category is the id only; the dialog's own markup holds the names, accents and icons, so the file does not repeat them.

**The file.** `src/pages/search-index.[hash].json.ts` emits `/search-index.<hash>.json`, where the hash is the first 12 hex digits of the SHA-256 of the content. Every page names it in `data-index` on the search dialog and nowhere else: no script, preload or prefetch (ADR 0046). Because the name changes when the content does, `apps/web/public/_headers` serves `/search-index.*` and `/_astro/*` with `Cache-Control: public, max-age=31536000, immutable`. Cloudflare's default for static assets is to revalidate on every load. `pnpm check:production` requests the live file and fails if the header is missing, because only a live request can prove it: `astro preview` ignores `_headers`.

**Size**, measured by `search.slow.test.ts`:

| Tools | Raw | gzip | brotli |
|---|---|---|---|
| 0 (the real build) | 24 B | 44 B | 28 B |
| 1,000 synthetic | 232.5 KB | 22.1 KB | 14.9 KB |

The synthetic tools reuse a small vocabulary, so they compress better than 1,000 real, different tools will. Expect the real gzip figure to be larger; it is fetched once, after intent, and cached for good.

**Reading it.** `parseSearchIndex()` (`parse.ts`) checks the shape and refuses anything else, including a `href` that is not a path on this site. A damaged or stale file becomes the honest "Search could not load" state, never an exception and never "no results".

### B. The engine

**Written for this site, no dependency** (`engine.ts`, about 4.6 KB gzip with the UI that uses it).

Why not a library:
- Highlighting needs the offset of every match in the original text. MiniSearch reports which terms matched in which field, not where, so we would write a second matcher for highlighting and keep it in agreement with the first. One matcher, used for scoring and for highlighting, cannot disagree with itself.
- "jpg to png" should put the tool that goes from JPG to PNG above the one that goes the other way. That is a scoring rule no library has; it would sit beside the library, not in it.
- No new dependency means no supply-chain surface, no `minimumReleaseAge` wait and no license paperwork (ADR 0017, ADR 0019).

The libraries considered, both within the 15 KB and license rules: MiniSearch 7.2.0 (MIT; prefix, fuzzy and field boosts; not measured here) and Fuse.js 7.5.0 (Apache-2.0; fuzzy matching by scanning every record on every keystroke, with no dictionary of words to match prefixes against). MiniSearch is the one to reach for if the engine ever needs more than this file does (see "Revisit when").

How a query is answered:
1. **Folding.** Text is lower-cased and stripped of accents one UTF-16 unit for one unit, so an offset in the folded text is an offset in the original. Words are runs of letters and digits.
2. **Matching each word** of the query against the dictionary of words in the index: exact (quality 1), prefix (0.6 to 0.9, more of the word typed is better), and only when a word has neither, typo tolerance: one typo in a word of 4 to 6 letters, two in 7 or more, a swap of neighbours counts as one (quality 0.4 and 0.3). Words under 4 letters are never guessed at, so "pdx" does not find "pdf". A typo in a half-typed word also matches (0.25), so "convrt" finds "converter".
3. **Every word must match** (AND). "pdf banana" finds nothing, honestly.
4. **Score** = the sum over the query's words of the best field weight times the match quality. Weights: name 10, tags 5, accepts and produces 3, summary 1. A whole-name match adds 100, a name that starts with the query 30, all words in the name 6.
5. **Formats.** `to`, `into` and an arrow (`->`, `→`) read as a direction: a tool whose `accepts` holds the left format and whose `produces` holds the right one adds 12. Stop words (`to`, `the`, `and`, `online` and a few more) are dropped from the query unless it is nothing else. `jpg`/`jpeg`, `tif`/`tiff`, `md`/`markdown` and `yml`/`yaml` match as one word.
6. **Ties** break by name, so the order is the same on every machine.

**Speed**, measured in the slow test tier on 1,000 synthetic tools (595 keystrokes of ten realistic queries, typed one letter at a time): median 0.43 ms, p95 1.34 ms, max 6.73 ms, against a limit of 10 ms for p95. Building the engine from the index takes about 70 ms, once, after intent. At 5,000 tools: median 0.79 ms, p95 2.86 ms.

### C. Showing a match safely

The engine returns offsets, never markup. `segments(text, ranges)` cuts a string into `{ text, match }` pieces and the UI turns each into a text node or a `<mark>` element. There is no `innerHTML`, `insertAdjacentHTML`, `DOMParser` or `eval` in the search code, and `search-dialog.test.ts` fails the build if one appears. A prefix match marks only what was typed (`comp` in **Comp**ress), an exact or typo match marks the whole word, and a letter with a combining accent stays whole. `<img onerror>` in a tool name, `&amp;` in a summary and markup typed into the box are all tested in Vitest and in Playwright, in three engines.

### D. What search does not do

- **No recent searches.** With zero tools there is nothing worth remembering, and a stored history is data about the visitor that needs a privacy statement. Revisit after Mission 13.
- **No query leaves the device.** The index is one static file; the engine runs in the browser. Nothing is logged, sent or stored.
- **No stemming, no synonyms beyond the four format pairs, no other languages** (see below).

## Consequences

- Good: no dependency; one matcher for ranking and highlighting; the order is deterministic; a keystroke costs about a millisecond at 1,000 tools, so the browser, not the engine, decides how fast search feels.
- Good: the index is a plain, cacheable file. A change of one word gives a new address, and an old address keeps working until the next deploy replaces it.
- Cost: we own the engine and its tests. The tests are the specification (`engine.test.ts`, `highlight.test.ts`, `search.slow.test.ts`).
- Cost: a visitor whose page was cached before a deploy asks for an index name that no longer exists. They get the "Search could not load" state, with a link to all tools, until they reload.
- The engine is English-oriented. Accents fold for Latin scripts; scripts without spaces (Chinese, Japanese) would need word segmentation. ADR 0023 plans more languages later.

## Revisit when

- The engine needs stemming, ranking by popularity or more than one language: switch to MiniSearch behind the same `createEngine` interface, and keep `segments` and the tests.
- The site passes about 5,000 tools: the dictionary scan per word grows with the number of distinct words, and a sorted dictionary with binary search for prefixes would replace it.
- The real index is much bigger than the synthetic one suggests: measure it after Mission 13 and consider dropping `summary` from the index in favour of the page's own text.
