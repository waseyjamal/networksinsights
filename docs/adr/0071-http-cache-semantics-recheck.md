# 0071. Keep the GHSA-ch52-4w7c-c8xp ignore until 2026-11-16

Status: Accepted
Date: 2026-10-10
Supersedes: the re-check date of [ADR 0059](0059-http-cache-semantics-audit-ignore.md)

## Context

ADR 0059 ignores GHSA-ch52-4w7c-c8xp (`http-cache-semantics` `max-stale` can serve cache entries zeroed for security) until 2026-10-17. Checked on 2026-10-10:

- The GitHub advisory (updated 2026-10-02) still lists `<= 4.2.0` as vulnerable and no first patched version.
- npm has `http-cache-semantics` 4.3.0 (2026-10-04). It is not a fix for this advisory: its changes are Vary matching (CVE-2026-93750), a response status and types. The `max-stale` code in `index.js` is the same as in 4.2.0. An override to 4.3.0 would only hide the advisory from `pnpm audit`.
- `pnpm why http-cache-semantics` still shows one path, `web > astro 7.3.2` (also through `@astrojs/mdx`). The newest `astro` (7.3.8) still depends on `^4.2.0`.
- Astro still uses it only in its build-time remote image cache. A search of `apps/web/dist` for `http-cache-semantics`, `CachePolicy` and `max-stale` finds nothing. It never reaches a visitor.

## Decision

Keep the ignore. Move the re-check date to 2026-11-16 in `scripts/audit-ignores.test.ts`, `pnpm-workspace.yaml` and `docs/launch-checklist.md`. The rest of ADR 0059 stands.

## Next re-check

1. The advisory page: is a first patched version listed?
2. npm: does a release after 4.3.0 change the `max-stale` handling in `index.js`? Diff it; do not trust the version number alone.
3. `pnpm why http-cache-semantics`, and whether a newer `astro` drops it.
4. After `pnpm build`, search `apps/web/dist` again.

With a real fix, override it as ADR 0067 did and delete the ignore. Without one, decide again in a new ADR.
