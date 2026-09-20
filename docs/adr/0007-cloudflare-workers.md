# 0007. Cloudflare Workers with static assets for hosting

Status: Accepted
Date: 2026-09-19

## Context

The site is static HTML first, and some tools need a server runtime.

## Decision

Host on Cloudflare Workers with static assets. The deploy pipeline is set up in Mission 5 (ADR 0027).

What was actually set up:

- One Worker named `networksinsights`, configured in `apps/web/wrangler.jsonc`. It serves the Astro build output as static assets and has no Worker script yet.
- Unknown paths get our own 404 page (`not_found_handling: "404-page"`).
- The site is served on the Custom Domain `https://networksinsights.com` (the canonical address, no `www`). `workers_dev` is off, so it is not reachable anywhere else. Preview URLs are on, one per pull request.
- Deploys run only from GitHub Actions, gated on the `quality` and `e2e` jobs. Nothing deploys from a local machine.
- Wrangler is a pinned devDependency, run through pnpm in CI.

## Consequences

Static pages and server tools share one hosting platform. Adding a Worker script later (for `server` tools) does not change the hosting or the pipeline.

## Revisit when

No trigger set.
