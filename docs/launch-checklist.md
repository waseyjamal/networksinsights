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

- [ ] **REQUIRED before launch: preview deployments (workers.dev) send `X-Robots-Tag: noindex` (Mission 12)**, because the `launched` flag stops covering them after launch. Until this is done, do not flip the flag.
- [ ] **Category and page copy**: read the intro and meta description of each category in `apps/web/src/config/categories.ts`. The meta descriptions currently end in "Coming soon to NetworksInsights"; edit them once the category has tools.
- [ ] **Home page claims**: the "Why NetworksInsights" points must still be true (private where the browser can do the job, free, fast, no sign-up). Remove any that are not.

## Launch day

- [ ] Set `launched` to `true` in `apps/web/src/config/site.ts` (Mission 18). Nothing else needs to change; `pnpm check` and the E2E tests cover both values of the flag.
- [ ] Deploy through CI ([runbook](runbooks/deploy-and-rollback.md)) and check that a page on the production domain no longer has a `noindex, nofollow` robots meta, while `/404` and `/design-system/` keep `noindex`.
