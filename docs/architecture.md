# Architecture

## Goal and scale

NetworksInsights.com is a free online tools platform. It starts at 500+ tools and must keep growing without limit while staying:

- fast (top-tier speed),
- discoverable (SEO for search engines, GEO for AI answer engines),
- secure,
- stable.

Every tool is a plugin that follows one contract: [tool-contract.md](tool-contract.md). Decisions are recorded in [adr/](adr/).

## Repository layout

Now:

```
apps/
  web/            Astro site (Astro, React islands, Tailwind)
    src/config/   site.ts (name, domain, tagline, launch flag), categories.ts (the 11 categories), headers.ts (every response header)
    src/styles/   design tokens and the one component stylesheet (Signal design system)
    src/components/ui/   Astro components; react/ holds the React versions
    src/components/layout/   site header and footer
    src/components/tool/     the tool page template
    src/layouts/  Base (head, theme script, search dialog and loader) and Page (skip link, header, main, footer)
    src/lib/registry/        finds and validates tools at build time; fixtures/ holds test tools
    src/lib/seo/             canonical and share tags, JSON-LD, sitemaps, robots.txt, llms.txt, IndexNow, share images (ADR 0038-0042)
    src/lib/search/          the search index builder, the engine, the browser code loaded on intent (ADR 0045, ADR 0046)
    src/lib/security/        builds dist/_headers and checks every inline script is hashed (ADR 0047, ADR 0048)
    src/lib/runtime/         saveFile, setText, safeUrl: the safe way for tools to give files and show text (ADR 0050)
    src/integrations/        security-headers: writes dist/_headers after every build
    src/pages/og/            the share images, drawn at build time; robots.txt, sitemaps and llms.txt are pages too
    src/pages/[slug].astro   one route for category pages and tool pages
packages/
  tool-sdk/       @networksinsights/tool-sdk: the contract as code (Zod only)
tools/            @networksinsights/tools: one folder per tool, <category-id>/<tool-id>/
scripts/          @networksinsights/scripts: new:tool, check:tools, check:budgets, check:seo, check:production, check:licenses, lockfile-diff, indexnow
docs/             architecture, tool contract, design system, ADRs
```

The first tool, `tools/text/word-counter`, arrived in Mission 13. The contract every folder follows is
[tool-contract.md](tool-contract.md); the decisions behind it are ADR 0031–0037. A tool is added
with `pnpm new:tool` ([adding-a-tool.md](adding-a-tool.md)) and held to the content quality gates
(ADR 0036) and the JavaScript budgets (ADR 0037).

## Tool runtimes

Each tool declares one runtime in its manifest.

| Runtime | Where it runs | Use it for |
|---|---|---|
| `client` | Browser main thread | Light, fast logic |
| `worker` | Browser Web Worker | Heavy work that must not block the page |
| `server` | Server | Work that cannot run on the device |

User files are processed on the device whenever possible.

## AI fallback chain

Tools that need AI try these in order:

1. Built-in browser AI.
2. In-browser model (WebGPU/WASM).
3. Server AI, with per-user rate limits and a hard daily spending cap.

## Quality targets

Core Web Vitals at the 75th percentile:

| Metric | Target |
|---|---|
| LCP | ≤ 2.5 s |
| INP | ≤ 200 ms |
| CLS | ≤ 0.1 |

Internal target: LCP under 1.5 s on a mid-range Android phone over slow 4G.

## Launch flag

`launched` in `apps/web/src/config/site.ts` is `true` since 2026-10-10. While it is false every page renders `noindex, nofollow`; now only pages that are not meant to be indexed keep `noindex` ([ADR 0029](adr/0029-pre-launch-noindex-flag.md)). The owner's remaining follow-ups are in [launch-checklist.md](launch-checklist.md).

## Search and AI answers

The site is built to be found (SEO) and quoted (GEO/AEO). Every page carries a canonical link on `https://networksinsights.com`, Open Graph and Twitter/X tags, and a share image drawn at build time ([ADR 0038](adr/0038-canonical-and-meta.md), [0041](adr/0041-share-images.md)). Structured data is generated from the same data as the page and tested against what the page shows ([ADR 0039](adr/0039-structured-data.md)). `robots.txt`, the sitemaps and `llms.txt` are generated; the sitemaps and `llms.txt` exist only after launch, and IndexNow announces changed URLs after each launched deploy ([ADR 0040](adr/0040-crawling-robots-and-ai-crawlers.md), [0042](adr/0042-indexnow.md)). Every tool page has visible Quick facts and an answer-first intro ([ADR 0044](adr/0044-aeo.md)). `pnpm check:seo` checks the build; `pnpm check:production` checks the live site.

## Security

Every response carries a strict Content-Security-Policy (deny by default, same-origin scripts only, inline scripts by hash) and the standard security headers, all from `apps/web/src/config/headers.ts` ([ADR 0047](adr/0047-content-security-policy.md), [0048](adr/0048-security-headers.md)). Preview deployments send `X-Robots-Tag: noindex`; production never does. A tool that needs more asks in its manifest, with an accepted ADR. Dependencies are updated weekly by Dependabot with a three-day cooldown, and CI fails on a moderate-or-worse advisory or a licence outside the allowed set ([ADR 0049](adr/0049-supply-chain-automation.md)). Tools give files and show text only through safe helpers, and a gate refuses HTML sinks; server tools follow a written contract ([ADR 0050](adr/0050-tool-runtime-safety-contract.md)). Procedures: [runbooks/security.md](runbooks/security.md).

Production counts page views, tool use, Core Web Vitals and scrubbed JavaScript errors with Umami Cloud: no cookies, no personal data, a 2.3 KB tracker served from our own origin and a script of ours under 1 KB, both deferred. Only the production build has a website id, so previews and local builds carry no analytics, and the privacy page describes exactly what the build does ([ADR 0051](adr/0051-analytics-and-error-reporting.md), [runbooks/analytics.md](runbooks/analytics.md)).

## Hosting

Cloudflare Workers with static assets, served on https://networksinsights.com. Deploys run only from CI ([ADR 0027](adr/0027-deployment.md), [runbook](runbooks/deploy-and-rollback.md)).

## Phase 1 missions

| # | Mission | Status |
|---|---|---|
| 1 | Project skeleton | Done |
| 2 | Project brain | Done |
| 3 | Quality gates | Done |
| 4 | CI pipeline | Done |
| 5 | Deploy pipeline | Done |
| 6 | Design system | Done |
| 7 | Site shell | Done |
| 8 | Tool contract + registry | Done |
| 9 | Generator + guardrails | Done |
| 10 | SEO/GEO engine | Done |
| 11 | Search | Done |
| 12 | Security | Done |
| 13 | Reference tool: browser | Done |
| 14 | Reference tool: worker | Done |
| 15 | Reference tool: server + AI | |
| 16 | Observability | Done |
| 17 | Offline + site-wide budgets | Done |
| 18 | Launch audit | |
| 19 | Agent handoff docs | Done |

Work outside the numbered missions: CI scope (#41, #42; ADR 0054, 0055, 0058) and Lighthouse shards
(#54, ADR 0063) cut CI minutes; tools ship in batches on `tool/batch-NN` branches (batches 1 to 10,
#45 to #67), and batch 1 added the Tailwind `@source` for `tools/`. The current tool count comes from
`ls tools/*/*/tool.config.ts | wc -l`.
