# 0067. Override sharp to its patched version

Status: Accepted
Date: 2026-10-07

## Context

`pnpm audit --audit-level moderate` fails on GHSA-wq5f-xc86-pv6w (CVE-2026-96889): `sharp` before
0.35.5. The lockfile resolves 0.35.4, the one version in the tree, through three paths: `astro`
7.3.2 (which asks for `^0.35.4`), `@astrojs/mdx` 8.0.1 (through astro) and `wrangler` 4.133.0 >
`miniflare` 5.20260916.0-alpha (which pins exactly `0.35.4`). Patched in 0.35.5.

No newer parent fixes it on its own: the latest `wrangler`, 4.148.0, depends on `miniflare`
5.20261006.0-alpha, which still pins `sharp` 0.35.4, and the latest `astro`, 7.3.6, still asks for
`^0.35.4`, which allows 0.35.5 but does not require it.

`sharp` is build-time and local-tooling only. Astro uses it for image processing at build time, and
miniflare for `wrangler dev`, which runs only for the E2E tests. It never reaches a visitor: after
`pnpm build`, `dist/` holds no file with sharp's code (no `sharp` import, no libvips, no `.node`
binary).

## Decision

Pin the exact vulnerable version to the exact patched one in `overrides` (`pnpm-workspace.yaml`),
as ADR 0065 did:

- `"sharp@0.35.4": "0.35.5"`: Apache-2.0, published on npm 2026-09-27, a patch release, past the
  three-day `minimumReleaseAge`; `pnpm install` resolved it without bypassing it.

astro's `^0.35.4` allows 0.35.5. miniflare's exact pin does not, so this override sets a version its
own range does not name: `pnpm check` and a full `pnpm build` pass with it; the E2E tests in CI run
`wrangler dev` with it. `pnpm audit --audit-level moderate` passes. It still prints the ignored
GHSA-ch52-4w7c-c8xp (ADR 0059), which this decision does not change.

## Remove when

Remove when miniflare (through wrangler) pins `sharp` 0.35.5 or later and astro resolves 0.35.5 or
later on its own. Then delete the override and its comment, run `pnpm install` and
`pnpm audit --audit-level moderate`, and note the removal here.
