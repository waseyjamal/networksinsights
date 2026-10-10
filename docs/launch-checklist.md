# Launch checklist

Everything the owner must provide or decide before `networksinsights.com` is opened to search engines and visitors. Pages that still wait for one of these items carry a visible "Draft: owner input needed" note. Remove the note when the item is done. Today that is `/privacy/` and `/terms/`, for the two review items below.

Until the last step is done, every page renders `noindex, nofollow` ([ADR 0029](adr/0029-pre-launch-noindex-flag.md)).

## Owner input

- [x] **Owner's public name**: Wasey Jamal, founder and developer, an individual in India (not a registered company). Written on `/about/`, `/privacy/` and `/terms/`. The © line in the footer stays "NetworksInsights", the site's name.
- [x] **Contact email**: `contact@networksinsights.com` is published on `/contact/`, `/privacy/` and `/terms/`. It is the only public address.
- [ ] **Verify the contact email works**: Cloudflare Email Routing must forward `contact@networksinsights.com` to the owner's inbox. Send it a test message and check that it arrives.
- [x] **Legal jurisdiction**: India. No court city is named, on purpose.
- [ ] **Privacy review**: read `/privacy/` and confirm every sentence is true of the site at launch. In particular confirm the hosting paragraph (Cloudflare receives request data such as the IP address) and the paragraph on tools that download model or library files, and update the page if advertising or any tool that uploads files goes live. Then remove the "Draft" note from the page.
- [ ] **Terms review**: `/terms/` is plain wording, not legal advice. Have it reviewed and approved before launch, then remove the "Draft" note from the page.

## Required before launch

- [x] **Preview deployments (workers.dev) send `X-Robots-Tag: noindex`** (Mission 12, [ADR 0048](adr/0048-security-headers.md)). The CI job `preview` checks every pull request's preview for it, and `verify-production` fails if production ever sends it.
- [ ] **Security in GitHub** (Settings, Advanced Security): turn on the **Dependency graph** and **Dependabot alerts**, then **Dependabot security updates**. They are free for private repositories. Dependabot version updates already run from `.github/dependabot.yml` ([ADR 0049](adr/0049-supply-chain-automation.md)).
- [ ] **HSTS preload** (decide at launch): the site sends `Strict-Transport-Security: max-age=63072000; includeSubDomains` without `preload` ([ADR 0048](adr/0048-security-headers.md)). To preload: confirm every subdomain serves HTTPS, turn on HSTS in the Cloudflare zone (SSL/TLS, Edge Certificates, HSTS: max-age 2 years, include subdomains, preload) so the `www` redirect carries it too, add `preload` to `securityHeaders` in `apps/web/src/config/headers.ts`, deploy, then submit at hstspreload.org. Removal from the list takes months to reach browsers.
- [ ] **security.txt**: publish `/.well-known/security.txt` (RFC 9116) now that the contact email is published (`contact@networksinsights.com`), with `Contact:` and an `Expires:` date a year out, so people who find a problem know where to write.
- [ ] **Network Error Logging (optional)**: Cloudflare adds `Report-To` and `NEL` headers, so browsers report connection errors to Cloudflare. Decide whether to keep it, and make sure the privacy page describes it if it stays.
- [ ] **Category and page copy**: read the intro and meta description of each category in `apps/web/src/config/categories.ts`. The meta descriptions currently end in "Coming soon to NetworksInsights"; edit them once the category has tools.
- [ ] **Home page claims**: the "Why NetworksInsights" points must still be true (private where the browser can do the job, free, fast, no sign-up). Remove any that are not.
- [ ] **Redirect rule (right after the Mission 10 merge)**: create the Cloudflare rule that sends `/tools` to `/tools/` with a 301, exactly as written in [runbooks/seo-redirects.md](runbooks/seo-redirects.md). Until it exists the CI job `verify-production` is red, on purpose. Re-run that job afterwards; it must go green.
- [ ] **IndexNow key**: create the repository *variable* `INDEXNOW_KEY` ([runbooks/indexnow.md](runbooks/indexnow.md)).
- [ ] **Analytics** (optional, any time): sign up for Umami Cloud's free Hobby plan, add the site and create the repository *variable* `UMAMI_WEBSITE_ID` ([runbooks/analytics.md](runbooks/analytics.md), [ADR 0051](adr/0051-analytics-and-error-reporting.md)). Until it exists the site has no analytics and the privacy page says so. After the next deploy, read the privacy page's Analytics section once more.
- [ ] **Static page dates**: `pageUpdated` in `apps/web/src/config/site.ts` is the `lastmod` of the home, tools, about, contact, privacy and terms pages in the sitemap. When the wording of one of these pages changes (for example when the "Draft: owner input needed" notes come out of `/privacy/` and `/terms/`; the four launch pages were dated 2026-10-10), change its date the same day. `sitemap.test.ts` fails on a full clone if you forget.
- [ ] **Training crawlers**: `trainingPolicy` in `apps/web/src/config/crawlers.ts` is `"allow"` (your decision, [ADR 0040](adr/0040-crawling-robots-and-ai-crawlers.md)). Change it to `"disallow"` before launch if you change your mind.
- [ ] **Tools before categories are indexed**: a category page is `noindex` and out of the sitemaps until it has a tool, so nothing to do; check that each category you expect to rank has at least one tool at launch.

## Launch day

- [ ] Set `launched` to `true` in `apps/web/src/config/site.ts` (Mission 18). Nothing else needs to change; `pnpm check` and the E2E tests cover both values of the flag.
- [ ] Deploy through CI ([runbook](runbooks/deploy-and-rollback.md)) and check that a page on the production domain no longer has a `noindex, nofollow` robots meta, while `/404` and `/design-system/` keep `noindex`.
- [ ] Install the site from Chrome on a desktop and on an Android phone, open a tool once, turn on flight mode and use it ([runbooks/pwa-and-play-store.md](runbooks/pwa-and-play-store.md)). The Play Store app is a separate, later decision: its `assetlinks.json` step is in the same runbook.
- [ ] Check what search engines now see: `https://networksinsights.com/robots.txt` has a `Sitemap:` line, `/sitemap-index.xml` and `/llms.txt` answer 200, the IndexNow key file `/<key>.txt` shows the key, and `pnpm check:production` passes.

## Search engines (after launch day)

Do these once the site is live. Search Console is how Google learns about the site; Bing can copy it.

- [ ] **Google Search Console**: add the *Domain* property `networksinsights.com` and verify it with the **DNS TXT record** that Search Console gives you (Cloudflare dashboard, DNS, add a TXT record on the apex). A Domain property covers `https`, `http` and every subdomain. Then submit `https://networksinsights.com/sitemap-index.xml` under Sitemaps.
- [ ] **Bing Webmaster Tools**: the simplest way is **Import from Google Search Console** once step one is done; the imported site is verified automatically. Bing's own DNS method is a **CNAME** record (not a TXT record): Bing Webmaster Tools shows the name and value to add in Cloudflare DNS, with the proxy turned off. Then submit the same sitemap index.
- [ ] **Watch the first weeks**: Search Console, Pages, shows why a page is not indexed; a category page with no tool is "Excluded by 'noindex' tag" on purpose.

## Yearly and dated reviews

- [ ] **Official figures**: once a year, re-read the source of every tool with official figures and update its data file, tax year and read date. Never from memory ([adding-a-tool.md](adding-a-tool.md#official-figures)).
- [ ] **US Federal Income Tax**: update the tax year when the IRS publishes the new figures, usually in October.
- [ ] **Australia Income Tax**: skipped because ato.gov.au returned 403. Try again only if the source can be read.
- [ ] **http-cache-semantics ([ADR 0059](adr/0059-http-cache-semantics-audit-ignore.md), [ADR 0071](adr/0071-http-cache-semantics-recheck.md))**: re-check by 2026-11-16; `scripts/audit-ignores.test.ts` fails after that date.
- [ ] **Dependabot pull requests**: some are known red. Review them; never merge one that fails CI.
- [ ] **Repository visibility**: `gh repo view` showed the repository as public on 2026-10-09. The Actions minutes limit applies again if it goes private ([runbooks/ci.md](runbooks/ci.md#billed-minutes)).
