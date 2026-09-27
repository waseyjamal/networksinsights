# 0051. Analytics and error reporting

Status: Accepted
Date: 2026-09-27

Amends [ADR 0046](0046-intent-loaded-search.md) (the search loader is the only script file a page without an island loads) and [ADR 0047](0047-content-security-policy.md) (`connect-src 'self'`, "no third party is ever contacted").

## Context

The owner needs to see which tools people use, how fast pages are for real visitors, and what breaks in their browsers. The site promises no cookies and no personal data, so no cookie banner, and every page is held to a small, exact JavaScript budget (ADR 0037, ADR 0046). Mission 15's server endpoint does not exist yet, so an error endpoint of our own is not an option.

Two candidates, checked against their own documentation on 2026-09-27:

| | Cloudflare Web Analytics | Umami Cloud (Hobby) |
|---|---|---|
| Price | Free | Free: 100k events a month, 6 months of data |
| Cookies | None | None; the IP address is not stored |
| Page views per path | Yes | Yes |
| Custom events ("tool used") | No ("not yet", their FAQ) | Yes, `umami.track()` |
| LCP, INP, CLS per page | Yes, with a debug view of the worst elements | Yes (`data-performance`, since v3.1), plus FCP and TTFB |
| Tracker | `beacon.min.js`, 10.1 KB gzip, from `static.cloudflareinsights.com` | `script.js`, 2.3 KB gzip, MIT licence |
| Data | Full data for 7 days, then about 10% | Full data for the retention period |

Cloudflare cannot count tool use, so it would need a second service beside it anyway.

## Decision

**Umami Cloud, one vendor, for all four needs.** Page views and Web Vitals come from Umami's tracker. A small script of ours sends two custom events.

**The tracker is served from our origin.** `apps/web/src/lib/analytics/umami-tracker.js` is a byte-for-byte copy of the tracker Umami Cloud serves (v3.4.0, MIT, see `VENDOR.md` there). The build copies it unchanged to `/_astro/umami-tracker.<hash>.js` (a content-hashed file, cached for a year). `script-src` stays `'self'`: a compromise at Umami cannot run code on our pages. A unit test and `pnpm check:budgets` pin its SHA-256, so neither an edit nor a build transform goes unnoticed. It is updated only by a person following `VENDOR.md`.

**Settings on the tag** (`components/layout/Analytics.astro`): `defer`; `data-domains` is the production domain, so previews and local runs send nothing; `data-performance` for Web Vitals; `data-exclude-search` and `data-exclude-hash`, so nothing after `?` or `#` is sent; `data-do-not-track`, so a browser that sends Do Not Track sends nothing. Requests go without credentials (the tracker's default).

**Two events of ours**, in the same component's script, a deferred module under 1 KB gzip (0.9 KB today). Astro would inline a bundled script this small that imports nothing, which would add a second inline script to every page; `vite.build.assetsInlineLimit` in `astro.config.mjs` keeps this one a file. It imports only `lib/analytics/events.ts`, never the site config, so nothing else is bundled into it:
- `tool-used`: once per page view, the first time a visitor types, pastes, drops, changes a setting or presses a button inside a tool's workspace (`data-ni-tool` on `ToolWorkspace`, set by `ToolPage`). It sends `{ tool: <id> }`. No tool code changes.
- `js-error`: uncaught errors and unhandled rejections, at most 3 distinct reports per page view. A report keeps the error's name; its message with quoted text, URLs, email addresses and numbers of four or more digits replaced, cut to 120 characters; the path of our own script (`"external"` for any other origin); the line and column; and the tool id. The rules are pure functions in `lib/analytics/events.ts`, unit tested.

Sentry's free plan (5k errors a month, one user) was the alternative for errors. It was left out because its browser SDK is over 20 KB gzip, it is a second vendor, and it needs its own privacy disclosure. It is the upgrade path if stack traces become necessary.

**On only in production.** Analytics are on when the build has `UMAMI_WEBSITE_ID`, a GitHub repository variable that only the production deploy passes. Without it, no page carries either file. The privacy page reads the same setting and describes analytics only when they are on, so it cannot disagree with the site. CI's `quality` and `e2e` jobs build with a test id, so budgets, the CSP and the tracker's behaviour are tested on the real output. `e2e/analytics.spec.ts` maps the production hostname to the local edge server in Chromium and answers Umami's endpoint itself: nothing leaves the machine.

**What changes in the rules.**
- ADR 0047: `connect-src` becomes `'self' https://gateway.umami.is`, the one third-party origin the policy names. Nothing else changes; `script-src` stays `'self'`.
- ADR 0046: a page carries the theme script, the search loader and, in a build with analytics, exactly these two deferred files: the tracker (classic script, at most 3 KB gzip) and our events script (module, at most 1 KB gzip). `pnpm check:budgets` (a new "Analytics" section), `budgets.spec.ts` and the unit tests enforce it. The search loader is unchanged, and the 2 KB limit is still the loader's alone.

## Consequences

- Page weight grows by about 3 KB gzip of deferred JavaScript (2.3 KB tracker, under 1 KB of ours). Neither file blocks rendering.
- Each page view costs about two events (the view and its Web Vitals report), plus one per tool use. The free plan's 100k events cover roughly 40,000 to 50,000 page views a month; beyond that the owner upgrades or turns Web Vitals off.
- Content blockers block Umami, so the numbers undercount. Cloudflare's own request counts in the dashboard are a rough cross-check.
- The visitor's IP address reaches Umami with each request. Umami uses it for the country and to hash a visitor id with a salt that changes monthly, and does not store it. The privacy page says so.
- The error reports are summaries, not stack traces. They say what broke and where, not why.

## Revisit when

- Mission 15's same-origin server exists: error reports could go there and leave `connect-src` at `'self'`.
- Traffic passes the free plan, or Umami changes its terms or its tracker protocol.
- Cloudflare Web Analytics gains custom events.
