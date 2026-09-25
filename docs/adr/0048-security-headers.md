# 0048. Security headers

Status: Accepted
Date: 2026-09-24

## Context

Until Mission 12 the site sent none of the standard security headers. Production answered HTML with Cloudflare's default `Cache-Control: public, max-age=0, must-revalidate`, and a preview on workers.dev answered `X-Robots-Tag: noindex` only because Cloudflare happened to add it. That behaviour is documented for Pages previews, not for Workers preview URLs, so the site cannot rely on it. Before launch the `launched` flag makes every page `noindex` (ADR 0029). After launch it stops protecting previews, so a preview could be indexed as a copy of the site (the debt left by Mission 10).

The site is static assets on Cloudflare Workers (ADR 0007). Cloudflare reads response headers for static assets from a `_headers` file. Rules match URL patterns, including absolute URLs with host placeholders. A matching rule adds its headers, `! Name` removes a header an earlier rule set, and the same header from two rules is joined with a comma. The limits are 100 rules and 2,000 characters a line. Headers reach every response, including files and the 404 page (checked in `wrangler dev`).

## Decision

**One source.** `apps/web/src/config/headers.ts` holds every header. After each build the security-headers integration writes `dist/_headers` from it and from the Content-Security-Policy (ADR 0047). `apps/web/public/_headers` is removed. `pnpm check:production` and the E2E tests read the same config, so the build, the tests and the live check cannot disagree.

**On every response:**

| Header | Value | Why |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | Two years, every subdomain: a browser that has seen the site never makes a plain-HTTP request to it again. |
| `X-Content-Type-Options` | `nosniff` | A file is only ever what its type says; a text file is never run as a script. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Another site learns only our origin, never the page or its query. |
| `Permissions-Policy` | every feature `=()`, except `fullscreen`, `picture-in-picture` and `autoplay` `=(self)` | Least privilege. |
| `Cross-Origin-Opener-Policy` | `same-origin` | No other site keeps a handle on our window. It is half of cross-origin isolation (ADR 0047). |
| `Cross-Origin-Resource-Policy` | `same-origin`; `cross-origin` on `/og/*`, `/favicon.ico` and `/favicon.svg` | Other sites cannot embed our files, except share images and favicons, which are meant for that. Crawlers fetch from servers, where CORP does not apply. |
| `X-Frame-Options` | `DENY` | `frame-ancestors 'none'` for browsers too old to know CSP 3. |
| `Content-Security-Policy` | ADR 0047 | |

**HSTS: two years, no preload yet (owner's decision).**
- `preload` puts the domain into the list browsers ship with, so even the first visit is HTTPS-only. It needs a max-age of at least one year, `includeSubDomains`, and HSTS on the HTTPS redirect of `www` too, which only a Cloudflare zone setting can send.
- Leaving the list takes months to reach browsers, and removing `preload` from the header makes the domain eligible for removal at once.
- `includeSubDomains` already commits every subdomain to HTTPS for two years. That is safe because every subdomain is proxied by Cloudflare, which serves HTTPS.
- Preloading is a launch-checklist item, decided at launch.

**Permissions-Policy.**
- The owner decided to deny camera, microphone and screen capture until a tool needs them; adding one takes an ADR.
- `fullscreen`, `picture-in-picture` and `autoplay` are allowed on our origin only, for video, image and audio tools. The browser still asks the visitor whenever a feature needs permission.
- `web-share` is not written out because its default is already our own origin, and Chromium builds without the Web Share API print a console warning for the name. `attribution-reporting` is left out for the same reason.
- Only names Chromium recognizes are listed, and the E2E test fails on any Permissions-Policy console warning, with one exception: Chromium on Linux has no Web Bluetooth and warns about `bluetooth`. The denial stays, because Chrome on Windows, macOS and Android knows the feature, and the test ignores that one warning (`platformDependentFeatures` in `config/headers.ts`).

**Previews.** A rule for `https://:alias.:account.workers.dev/*` adds `X-Robots-Tag: noindex`. It matches every preview URL of the Worker and never the production domain.
- `e2e/headers.spec.ts` proves it by Host header against `wrangler dev`: noindex for a workers.dev host, none for `networksinsights.com`.
- The `preview` CI job runs `pnpm check:production --preview` against the real preview URL of every pull request.
- `verify-production` fails if production ever sends noindex.

**Caching.**
- `/_astro/*` and `/search-index.*` carry a hash of their content in their names, so they get `public, max-age=31536000, immutable`.
- Every other response, HTML included, keeps Cloudflare's default `public, max-age=0, must-revalidate` with an ETag: a visit always revalidates, and an unchanged page answers `304 Not Modified` without a body.
- No site-wide `Cache-Control` rule is written, because Cloudflare would join it with the immutable one on hashed files.

**Checked live.** `pnpm check:production` fetches the home page, `/tools/`, a 404, `robots.txt`, the favicon, a share image and a hashed script. It fails on any missing or different header, on a CSP that is not the page's own policy plus `frame-ancestors`, on noindex in production or its absence on a preview, and on wrong cache headers.

## Consequences

- Good: every response carries the same headers, and changing one is one line in one file.
- Good: previews can never be indexed, whatever the launch flag says, and production can never be noindexed by a stray rule.
- Cost: headers are applied by Cloudflare, which `astro preview` does not imitate. The E2E header and CSP tests run against `wrangler dev` (`e2e/wrangler.e2e.jsonc`, which mirrors `wrangler.jsonc` without the route, because a route makes `wrangler dev` rewrite the Host header; a unit test keeps the two in step).
- Cost: HSTS with `includeSubDomains` rules out any plain-HTTP subdomain for two years.

## Revisit when

- Launch: decide on HSTS preload (docs/launch-checklist.md).
- A tool needs camera, microphone, screen capture or another denied feature: an ADR adds it.
- The site gets a Worker script: headers could be set in code, and `_headers` would go.
