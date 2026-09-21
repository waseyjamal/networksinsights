# Runbook: permanent redirect for slashless URLs

Why: [ADR 0038](../adr/0038-canonical-and-meta.md). Every page lives at a URL that ends in a slash (`/tools/`). Cloudflare's own redirect from `/tools` to `/tools/` answers **307**, which search engines treat as temporary, in every `html_handling` mode (`wrangler.jsonc` cannot change it). A Redirect Rule in the dashboard answers **301** before the request reaches the Worker, so it costs no Worker request and adds no latency. It is free on the Free plan (10 Single Redirect rules).

You create the rule once, in the Cloudflare dashboard. Nothing in the repository can create it, so the post-deploy check proves it exists (below).

## Create the rule

1. Cloudflare dashboard, the zone `networksinsights.com`, then **Rules**, **Redirect Rules**, **Create rule** ("Custom filter expression").
2. Name: `Add the trailing slash`.
3. Choose **Edit expression** and paste exactly:

   ```
   (http.host eq "networksinsights.com" and not ends_with(http.request.uri.path, "/") and not http.request.uri.path contains ".")
   ```

4. **Then**: type **Dynamic**, expression:

   ```
   concat("https://networksinsights.com", http.request.uri.path, "/")
   ```

5. Status code **301** (308 is equivalent for search engines; 301 is the one this runbook and the check are written for). Tick **Preserve query string**.
6. Deploy the rule.

What it does and does not touch:

| Request | Result |
|---|---|
| `/tools` | 301 to `/tools/` |
| `/word-counter` | 301 to `/word-counter/` |
| `/tools?ref=a` | 301 to `/tools/?ref=a` (the query string is kept) |
| `/` | untouched: the path already ends in a slash, so the root is never redirected |
| `/tools/` | untouched |
| `/favicon.ico`, `/robots.txt`, `/og/home.png`, `/sitemap-index.xml`, `/.well-known/...` | untouched: anything with a dot is a file |
| `www.networksinsights.com/tools` | untouched by this rule (the host must be the apex). The existing `www` rule sends it to the apex first, and this rule then sends it to `/tools/`. |
| `pr-N-networksinsights.<account>.workers.dev` | not on the zone, so never touched; previews keep the 307 and are `noindex` |

The expression uses only `ends_with()`, `contains` and `concat()`. Cloudflare's documentation places no plan restriction on them (only the `matches` regular-expression operator needs a Business plan), but the documentation cannot prove the Free plan accepts the rule, so **check that the dashboard saves it**. If it refuses an operator, build the same three conditions with the dashboard's form fields instead of the expression editor (Hostname equals `networksinsights.com`; URI Path does not end with `/`, or does not match it with a wildcard; URI Path does not contain `.`), and record what you had to change in this file.

## Check it

After the rule is live:

```
pnpm check:production
```

or, with no checkout, `curl -sI https://networksinsights.com/tools`, which must print `HTTP/2 301` and `location: /tools/` (or the absolute address).

`pnpm check:production` also checks that `/`, `/tools/`, `/favicon.ico` and `/robots.txt` answer 200 with no redirect, that an unknown page answers 404, that the home page's canonical is the production home page, and that `robots.txt` matches the launch flag. CI runs it after every production deploy as the job `verify-production`, trying six times ten seconds apart. **Until this rule exists that job is red.** It blocks nothing; create the rule, then re-run the job (Actions, the run, "Re-run failed jobs").

## If it fails

- **`/tools` answers 307:** the rule is missing, disabled, or below another redirect rule that matched first. Rule order matters: put this one above any broader rule.
- **A file such as `/favicon.ico` redirects:** the expression lost `not http.request.uri.path contains "."`.
- **`/` redirects in a loop:** the expression lost `not ends_with(http.request.uri.path, "/")`.
- **A redirect goes to `http://`:** the target expression lost `https://`.
