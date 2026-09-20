# 0032. Tools workspace at the repo root

Status: Accepted
Date: 2026-09-20

## Context

The site starts at 500+ tools and keeps growing. Every tool is a folder of its own
([tool-contract.md](../tool-contract.md)). Where those folders live is a decision that gets very
expensive to change later: moving 500 folders rewrites every import, every URL in the git history
and every path in the docs.

`apps/web/src/tools/` would be the obvious place today, because only the website reads them now.
But tool logic is pure TypeScript that a Cloudflare Worker will run without Astro (ADR 0012), and a
future API app would then be importing from inside the website.

## Decision

Tools live at `tools/<category-id>/<tool-id>/`, at the repo root, in a workspace package named
`@networksinsights/tools`.

- `pnpm-workspace.yaml` lists `tools` beside `apps/*` and `packages/*`.
- The package declares `@networksinsights/tool-sdk` and `zod`, and holds no shared code. Shared
  code belongs to the SDK (ADR 0031).
- The folder name is the tool id and the URL; the parent folder name is the category id. The
  registry fails the build if either disagrees with the manifest (ADR 0033).
- `apps/web` reads the folders through build-time globs and declares the package as a dependency,
  so the relationship is written down rather than implied by a relative path.

### Tests

`tools/vitest.config.ts` makes the folder a Vitest project, so every tool's required `logic.test.ts`
runs as soon as a tool exists. The root config lists it beside `apps/*` and `packages/*`.

This project sets `passWithNoTests: true`, and it is the only one that does. There are no tools
until Mission 13, and the repo-wide default stays false (ADR 0011), so a run that finds no tests
anywhere still fails. Nothing is lost by the override: a tool without a `logic.test.ts` fails the
build in the registry's file check, not in Vitest.

## Consequences

- A future API Worker imports `tools/<category>/<tool>/logic.ts` directly, with no website in the
  dependency chain.
- Tool folders are visible at the top of the repo, which is where a contributor looks for them.
- The web app's globs reach above its own root (`../../../../../tools/*/*/`). That works, and it is
  checked by a test, but it is unusual enough to deserve the comment it has.
- The repo root has one more entry.

## Revisit when

Tools need to be split across several packages — by category, or by weight — or the flat
`<category>/<tool>` layout stops being enough to find a tool quickly.
