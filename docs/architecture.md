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
    src/config/   site.ts (name, domain, tagline, launch flag) and categories.ts (the 11 categories)
    src/styles/   design tokens and the one component stylesheet (Signal design system)
    src/components/ui/   Astro components; react/ holds the React versions
    src/components/layout/   site header and footer
    src/components/tool/     the tool page template
    src/layouts/  Base (head, theme script) and Page (skip link, header, main, footer)
    src/lib/registry/        finds and validates tools at build time; fixtures/ holds test tools
    src/pages/[slug].astro   one route for category pages and tool pages
packages/
  tool-sdk/       @networksinsights/tool-sdk: the contract as code (Zod only)
tools/            @networksinsights/tools: one folder per tool, <category-id>/<tool-id>/
scripts/          @networksinsights/scripts: new:tool, check:tools, check:budgets
docs/             architecture, tool contract, design system, ADRs
```

`tools/` is empty until Mission 13. The contract every folder follows is
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

## Pre-launch protection

`launched` in `apps/web/src/config/site.ts` is `false` until launch day. While it is false every page renders `noindex, nofollow` ([ADR 0029](adr/0029-pre-launch-noindex-flag.md)). Everything the owner must do before flipping it is in [launch-checklist.md](launch-checklist.md).

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
| 9 | Generator + guardrails | In progress |
| 10 | SEO/GEO engine | |
| 11 | Search | |
| 12 | Security | |
| 13 | Reference tool: browser | |
| 14 | Reference tool: worker | |
| 15 | Reference tool: server + AI | |
| 16 | Observability | |
| 17 | Offline + site-wide budgets | |
| 18 | Launch audit | |
