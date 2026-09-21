# 0042. IndexNow

Status: Accepted
Date: 2026-09-21

## Context

IndexNow lets a site tell search engines which URLs changed instead of waiting to be crawled. Its documentation (indexnow.org): a key of 8 to 128 letters, digits and dashes; a file `https://<host>/<key>.txt` that contains the key, which is how the engines check ownership; a JSON request of up to 10,000 URLs to `https://api.indexnow.org/indexnow`, which shares it with the other participants; answers 200 or 202 for success, 403 for a key that does not match, 422 for a URL that is not on the host, 429 for too many requests. The participants are Bing, Yandex, Naver, Seznam, Yep and Amazon. **Google does not take part.** The guidance is to send only URLs that changed and never to resend unchanged ones.

## Decision

The simplest design that works has no server and no stored state. The sitemap is the record of what changed, because its `lastmod` comes from real data (ADR 0040).

1. **The key** is a GitHub Actions variable, `INDEXNOW_KEY`: 32 hex characters, made once with `openssl rand -hex 16`. A variable and not a secret, because the key is published at `/<key>.txt` by design; a variable can be rotated in one place. It never appears in the repository.
2. **The key file is generated, checked first.** The build (`pages/[file].txt.ts`) writes `/<key>.txt`, whose whole content is the key, only when the site is launched and the key matches `^[A-Za-z0-9-]{8,128}$`. A key that is missing or malformed is never turned into a file (a value like `../x` cannot become a path), and the build does not fail: nothing is written and the announcement step later says why it did nothing.
3. **Before the production deploy**, CI runs `pnpm indexnow snapshot`, which saves the sitemaps that are live now (nothing on the very first deploy).
4. **After the deploy**, CI runs `pnpm indexnow submit`. It compares the snapshot with the sitemaps of the new build and takes the URLs that are new or whose `lastmod` changed. It does nothing, and prints why, if the site is not launched, the key is missing or invalid, the build has no sitemap, or nothing changed. Otherwise it first fetches `/<key>.txt` from the live site (up to six tries, five seconds apart, while the deploy reaches every edge) and only sends if the file holds the key. Then it posts the URLs in requests of at most 10,000 and reports what each answer means.
5. **It can never fail a deploy.** Both steps are `continue-on-error`, and the announcement runs after the deploy has finished.

The logic is pure and tested with a fake `fetch`: the key rules, the diff, the batching, the request body (a URL on another host is refused before it is sent) and every outcome above.

## Consequences

- Only launched production deploys announce anything; previews and pre-launch deploys never do.
- A removed page is not announced; it answers 404 and is found on the next crawl.
- The first deploy after launch announces every URL, which is what a new site should do.
- Setting up: one repository variable (`docs/runbooks/indexnow.md`). Rotating: replace the variable and deploy.
- Google is reached through its own crawling and Search Console, not through this.

## Revisit when

Google adopts IndexNow, the number of URLs per deploy grows past what one snapshot comparison should handle, or a second host is added.
