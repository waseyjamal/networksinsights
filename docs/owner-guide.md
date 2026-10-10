# Owner guide

This guide is for the owner, not for AI agents. Agents follow [AGENTS.md](../AGENTS.md). Short sentences, plain words.

## 1. Where the project stands today

- **Tools**: 100 tools on 2026-10-10. To count them yourself, run `ls tools/*/*/tool.config.ts | wc -l` in Git Bash from the repo folder.
- **What is live**: every merge into `main` deploys the site to `networksinsights.com` through CI (the automatic checks on GitHub). The pages answer, and indexable pages are open to search engines.
- **Launched**: `launched` is `true` in `apps/web/src/config/site.ts`, deployed on 2026-10-10. Indexable pages no longer say `noindex, nofollow`; the design-system page, the 404 page and category pages with no tool keep `noindex` ([ADR 0029](adr/0029-pre-launch-noindex-flag.md)).

## 2. What is left after launch

The full list is [launch-checklist.md](launch-checklist.md). Open items:

**You must provide or decide**

- **Privacy review**: read `/privacy/` and confirm every sentence is true, then remove its "Draft" note. The public name (Wasey Jamal), the contact email (`contact@networksinsights.com`) and the governing law (India) are already written on About, Contact, Privacy and Terms.
- **Terms review**: have `/terms/` reviewed. It is plain wording, not legal advice. Then remove its "Draft" note.
- **GitHub security settings**: Settings, Advanced Security: turn on Dependency graph, Dependabot alerts and Dependabot security updates.
- **HSTS preload**: decide yes or no. HSTS tells browsers to always use HTTPS. Preload is hard to undo (months). Steps are in the checklist.
- **security.txt**: done. Renew its `Expires` date (`apps/web/src/lib/seo/security-txt.ts`) before 2027-10-10; the build check and a test fail once it has passed.
- **Network Error Logging**: Cloudflare can make browsers report connection errors to it. Keep or remove; if kept, the privacy page must say so.
- **Category copy**: read each category text in `apps/web/src/config/categories.ts`; remove "Coming soon" from categories that have tools.
- **Home page claims**: the "Why NetworksInsights" points must all be true.
- **Static page dates**: when the text of the home, tools, about, contact, privacy or terms page changes, update `pageUpdated` in `apps/web/src/config/site.ts` the same day.
- **AI training crawlers**: `trainingPolicy` is `"allow"`. Change to `"disallow"` only if you change your mind.
- **Categories with tools**: check that each category you want in Google has at least one tool.

**Looks done, please verify**

- **Contact email** (`contact@networksinsights.com`): send a test message from another account and check that it reaches your inbox. Cloudflare Email Routing must forward it.
- **Redirect rule** (`/tools` to `/tools/`): run `curl -sI https://networksinsights.com/tools`. It must print `301` and `location: /tools/`. Also the latest `verify-production` job on GitHub Actions must be green.
- **IndexNow key** (a public code that lets Bing learn about new pages fast): on GitHub, Settings, Secrets and variables, Actions, Variables tab: `INDEXNOW_KEY` must exist. After launch, `https://networksinsights.com/<key>.txt` shows the key ([runbooks/indexnow.md](runbooks/indexnow.md)).
- **Analytics** (`UMAMI_WEBSITE_ID`): same Variables tab, the variable must exist. Then open `/privacy/`: its Analytics section must describe Umami. Open a tool and watch Umami's Realtime view ([runbooks/analytics.md](runbooks/analytics.md)).

**Launch day**: done on 2026-10-10 (`launched` set to `true`, deployed by CI). Still to do: the "Launch day" and "Search engines" parts of the checklist (Google Search Console, Bing Webmaster Tools).

## 3. Dated duties

- **http-cache-semantics re-check, due 2026-11-16** ([ADR 0071](adr/0071-http-cache-semantics-recheck.md), which moved the date from [ADR 0059](adr/0059-http-cache-semantics-audit-ignore.md)). A security warning exists for this package. It is used only while the site is built, never sent to visitors, and no fix exists yet, so the warning is ignored until that date. Before the date, ask an AI session to "do the http-cache-semantics re-check from ADR 0071". If you forget, the test `scripts/audit-ignores.test.ts` fails on and after that date, so every pull request goes red until someone re-checks and writes a new ADR (a short decision file in `docs/adr/`).
- **US federal tax figures**: when the IRS publishes the next tax year's figures (usually October), update the US Federal Income Tax tool's data file, tax year and read date.
- **UK and Canada rules, once a year**: re-read the gov.uk Stamp Duty pages and the CMHC and Canadian law pages listed in each tool's `data.ts`, and update figures and read dates. Do the same for the India income tax tool after each Budget. Figures always come from the official source, never from memory.
- **Every Monday: Dependabot**. Dependabot opens grouped update pull requests each Monday. Look at them. Merge only the green ones. Some are known red; leave those open or close them.

## 4. How to start a new AI session

1. Open a terminal in the repo folder (`C:\dev\networksinsights`) and run `claude`. It reads `CLAUDE.md` and `AGENTS.md` by itself.
2. First message to paste:

   > Read AGENTS.md, docs/owner-guide.md and docs/launch-checklist.md. Then tell me in 5 lines what state the project is in. Do not change anything yet.

3. Test question to prove it read the rules:

   > May you merge a pull request, or deploy from my machine?

   The right answer is no to both: the owner merges, and deploys happen only through CI.

## 5. How to add a tool after launch

**With AI**

1. Start a session (section 4). Paste the prompt from [adding-a-tool.md](adding-a-tool.md), "The prompt to give Claude Code", with your tool filled in.
2. The agent shows a plan. Read it. Say yes or ask for changes.
3. The agent creates the branch `tool/<tool-id>`, builds the tool, runs `pnpm check`, pushes and opens a pull request.

**Without AI**

Follow [adding-a-tool.md](adding-a-tool.md) step by step: `pnpm new:tool` with flags, write the logic and content, `pnpm check:tools --tool <id>`, `pnpm check`, push, open a pull request.

**Your part, every time**

1. **Check CI**: on the pull request page every check must be green.
2. **Test the preview**: the `preview` job posts a preview link. Open it, use the tool, try a phone-size window.
3. **Squash and merge**: on GitHub, choose "Squash and merge". Only when everything is green.
4. **Check the main run**: Actions tab, the new run on `main`. `deploy` and `verify-production` must go green. Then open the tool on the live site.

## 6. How to read CI

- **Green tick**: the check passed.
- **Red cross**: the check failed. Do not merge.
- **Where is the error**: on the pull request, click "Details" next to the red check. Open the red step. The error text is usually near the bottom of that step. More in [runbooks/ci.md](runbooks/ci.md).
- **The mirror stall**: if a red job's log shows many `Ign` lines, or "The operation was canceled" while installing Playwright (the test browsers), the download server stalled. It is not your change. Click **Re-run failed jobs** once. If it fails the same way again, wait and re-run later.
- **Skipped jobs**: when a pull request changes only tool folders, CI runs fewer jobs on purpose. That is normal.

## 7. Never do these by hand

- Never edit security headers or write a `_headers` file. Headers come only from `apps/web/src/config/headers.ts`.
- Never deploy from your own computer. Deploys happen only through CI.
- Never commit secrets, passwords or `.env` files.
- Never merge a pull request with a red check, including Dependabot ones.
- Never commit straight to `main`. Always a branch and a pull request.

Questions about the site: contact@networksinsights.com.
