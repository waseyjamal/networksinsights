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
docs/             architecture, tool contract, ADRs
```

Planned:

```
packages/*                        shared tool SDK and UI (workspace packages)
tools/<category>/<tool-id>/       one folder per tool plugin (planned for Mission 8)
```

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
| 6 | Design system | |
| 7 | Site shell | |
| 8 | Tool contract + registry | |
| 9 | Generator + guardrails | |
| 10 | SEO/GEO engine | |
| 11 | Search | |
| 12 | Security | |
| 13 | Reference tool: browser | |
| 14 | Reference tool: worker | |
| 15 | Reference tool: server + AI | |
| 16 | Observability | |
| 17 | Offline + budgets | |
| 18 | Launch audit | |
