# 0059. Ignore GHSA-ch52-4w7c-c8xp until 2026-10-17

Status: Accepted; re-check date superseded by ADR 0071 (2026-11-16)
Date: 2026-10-03

## Context

`pnpm audit --audit-level moderate` fails on GHSA-ch52-4w7c-c8xp (CVE-2026-93748, high): `http-cache-semantics` up to 4.2.0 lets a client's `max-stale` return shared-cache entries that were zeroed for security, which can disclose another user's cached response. No patched version exists: 4.2.0 is the latest on npm, and the newest `astro` (7.3.5) still depends on `^4.2.0`. No override can fix it.

`pnpm why http-cache-semantics` shows one path: `web > astro 7.3.2` (also through `@astrojs/mdx`). Astro uses it only in `dist/assets/build/remote.js`, the build-time cache for remote images. The site is static, and the Worker serves static assets only, with no Worker script (ADR 0027). A search of `apps/web/dist` for `http-cache-semantics`, `CachePolicy` and `max-stale` finds nothing. The package never reaches a visitor and no shared cache built on it serves users.

## Decision

Ignore only this advisory with `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`. `pnpm audit` still reports every other advisory. `scripts/audit-ignores.test.ts` fails in `pnpm check` after 2026-10-17, and also fails on any ignored advisory without a re-check date.

## Remove when

A patched `http-cache-semantics` is released, or Astro drops it. Then delete the ignore and its test entry. If neither has happened by 2026-10-17, decide again in a new ADR.
