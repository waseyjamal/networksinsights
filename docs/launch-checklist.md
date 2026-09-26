# Launch checklist

Everything the owner must provide or decide before `networksinsights.com` is opened to search engines and visitors. Pages that need one of these items carry a visible "Draft: owner input needed" note. Remove the note when the item is done.

Until the last step is done, every page renders `noindex, nofollow` ([ADR 0029](adr/0029-pre-launch-noindex-flag.md)).

## Owner input

- [ ] **Owner's public name**: the person or organization that runs the site. Needed on `/about/`, `/privacy/` and `/terms/` (and for the © line in the footer, which today says "NetworksInsights").
- [ ] **Contact email**: set up `hello@networksinsights.com` with Cloudflare Email Routing, forwarding to the owner's inbox; then publish it on `/contact/` (and in `/privacy/`).
- [ ] **Legal jurisdiction**: the governing law for `/terms/` and `/privacy/`.
- [ ] **Privacy review**: read `/privacy/` and confirm every sentence is true of the site at launch. In particular confirm the hosting paragraph (Cloudflare receives request data such as the IP address), and update the page if analytics, advertising or any tool that uploads files goes live.
- [ ] **Terms review**: `/terms/` is a structure, not legal advice. Have it reviewed and approved before launch.

## Required before launch

- [x] **Preview deployments (workers.dev) send `X-Robots-Tag: noindex`** (Mission 12, [ADR 0048](adr/0048-security-headers.md)). The CI job `preview` checks every pull request's preview for it, and `verify-production` fails if production ever sends it.
- [ ] **Security in GitHub** (Settings, Advanced Security): turn on the **Dependency graph** and **Dependabot alerts**, then **Dependabot security updates**. They are free for private repositories. Dependabot version updates already run from `.github/dependabot.yml` ([ADR 0049](adr/0049-supply-chain-automation.md)).
- [ ] **HSTS preload** (decide at launch): the site sends `Strict-Transport-Security: max-age=63072000; includeSubDomains` without `preload` ([ADR 0048](adr/0048-security-headers.md)). To preload: confirm every subdomain serves HTTPS, turn on HSTS in the Cloudflare zone (SSL/TLS, Edge Certificates, HSTS: max-age 2 years, include subdomains, preload) so the `www` redirect carries it too, add `preload` to `securityHeaders` in `apps/web/src/config/headers.ts`, deploy, then submit at hstspreload.org. Removal from the list takes months to reach browsers.
- [ ] **security.txt**: publish `/.well-known/security.txt` (RFC 9116) once the contact email exists, with `Contact:` and an `Expires:` date a year out, so people who find a problem know where to write.
- [ ] **Network Error Logging (optional)**: Cloudflare adds `Report-To` and `NEL` headers, so browsers report connection errors to Cloudflare. Decide whether to keep it, and make sure the privacy page describes it if it stays.
- [ ] **Category and page copy**: read the intro and meta description of each category in `apps/web/src/config/categories.ts`. The meta descriptions currently end in "Coming soon to NetworksInsights"; edit them once the category has tools.
- [ ] **Home page claims**: the "Why NetworksInsights" points must still be true (private where the browser can do the job, free, fast, no sign-up). Remove any that are not.
- [ ] **Redirect rule (right after the Mission 10 merge)**: create the Cloudflare rule that sends `/tools` to `/tools/` with a 301, exactly as written in [runbooks/seo-redirects.md](runbooks/seo-redirects.md). Until it exists the CI job `verify-production` is red, on purpose. Re-run that job afterwards; it must go green.
- [ ] **IndexNow key**: create the repository *variable* `INDEXNOW_KEY` ([runbooks/indexnow.md](runbooks/indexnow.md)).
- [ ] **Static page dates**: `pageUpdated` in `apps/web/src/config/site.ts` is the `lastmod` of the home, tools, about, contact, privacy and terms pages in the sitemap. When the wording of one of these pages changes (for example when the "Draft: owner input needed" notes come out), change its date the same day. `sitemap.test.ts` fails on a full clone if you forget.
- [ ] **Training crawlers**: `trainingPolicy` in `apps/web/src/config/crawlers.ts` is `"allow"` (your decision, [ADR 0040](adr/0040-crawling-robots-and-ai-crawlers.md)). Change it to `"disallow"` before launch if you change your mind.
- [ ] **Tools before categories are indexed**: a category page is `noindex` and out of the sitemaps until it has a tool, so nothing to do; check that each category you expect to rank has at least one tool at launch.

## Launch day

- [ ] Set `launched` to `true` in `apps/web/src/config/site.ts` (Mission 18). Nothing else needs to change; `pnpm check` and the E2E tests cover both values of the flag.
- [ ] Deploy through CI ([runbook](runbooks/deploy-and-rollback.md)) and check that a page on the production domain no longer has a `noindex, nofollow` robots meta, while `/404` and `/design-system/` keep `noindex`.
- [ ] Check what search engines now see: `https://networksinsights.com/robots.txt` has a `Sitemap:` line, `/sitemap-index.xml` and `/llms.txt` answer 200, the IndexNow key file `/<key>.txt` shows the key, and `pnpm check:production` passes.

## Search engines (after launch day)

Do these once the site is live. Search Console is how Google learns about the site; Bing can copy it.

- [ ] **Google Search Console**: add the *Domain* property `networksinsights.com` and verify it with the **DNS TXT record** that Search Console gives you (Cloudflare dashboard, DNS, add a TXT record on the apex). A Domain property covers `https`, `http` and every subdomain. Then submit `https://networksinsights.com/sitemap-index.xml` under Sitemaps.
- [ ] **Bing Webmaster Tools**: the simplest way is **Import from Google Search Console** once step one is done; the imported site is verified automatically. Bing's own DNS method is a **CNAME** record (not a TXT record): Bing Webmaster Tools shows the name and value to add in Cloudflare DNS, with the proxy turned off. Then submit the same sitemap index.
- [ ] **Watch the first weeks**: Search Console, Pages, shows why a page is not indexed; a category page with no tool is "Excluded by 'noindex' tag" on purpose.
