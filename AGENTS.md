# AGENTS.md

Rulebook for every AI coding agent working in this repository. Read it fully before you plan anything.

## Project

NetworksInsights.com is a free online tools platform. It starts at 500+ tools and grows without limit. Every tool is a plugin that follows one contract: `docs/tool-contract.md`.

## Workflow

1. Plan first. Show the full plan and wait for the owner's approval before changing anything.
2. One mission = one branch, named `mission/NN-short-name`.
3. Never commit to `main`. Never merge; the owner merges.
4. Work only inside this repository.
5. End every mission with the report format that the mission asks for.

## Hard rules

Dependencies:
- Exact versions only. No `^`, no `~`, no ranges.
- No alpha, beta, rc or canary versions.
- Never bypass `minimumReleaseAge`.
- Never approve dependency build scripts (`allowBuilds` stays denied by default).
- Before adding any dependency, state in the plan why it is needed, its size impact and its license.

UI:
- UI must use design tokens and existing components; new components go into the design system first.

Safety:
- Never commit secrets or `.env` files.
- No global installs and no global config changes.
- Never deploy from a local machine; deploys happen only through CI.

## License rule

No AGPL, GPL, SSPL or non-commercial licenses, for code, fonts or AI models, without an owner-approved ADR.

## Architecture principles

- Static HTML first. JavaScript only inside islands.
- Tool logic is pure TypeScript with no UI or framework imports.
- Three runtimes: browser, worker, server.
- Process user files on the device whenever possible.
- Every page must be complete HTML without JavaScript, so crawlers can read it.

## Commands

Run from the repo root:

- `pnpm dev` — start the dev server
- `pnpm build` — production build
- `pnpm preview` — preview the production build
- `pnpm lint` — Biome check, no writes
- `pnpm fix` — Biome check with safe fixes written
- `pnpm typecheck` — type check the web app (`astro check`)
- `pnpm test` — run Vitest (fails if no tests are found)
- `pnpm test:e2e` — build, then run the Playwright E2E tests on chromium, firefox and webkit against `astro preview`. Not part of `pnpm check` or the pre-push hook because it is slow; it runs in CI and on demand. First run needs `pnpm --filter web exec playwright install` (browsers go to Playwright's cache outside the repo).
- `pnpm check` — typecheck, then lint, then test; stops at the first failure

Git hooks (husky, see ADR 0024): pre-commit runs Biome on staged files; pre-push runs `pnpm check`.

CI (see ADR 0025): `.github/workflows/ci.yml` runs job `quality` (`pnpm check`, `pnpm build`) and job `e2e` (`pnpm test:e2e`) on every pull request to `main` and every push to `main`. Actions are pinned to full commit SHAs.

Deploy (see ADR 0027): after `quality` and `e2e` pass, `ci.yml` job `preview` uploads a per-PR preview version, and job `deploy` deploys production on push to `main`. `.github/workflows/rollback.yml` is a manual rollback, from `main` only. Wrangler is pinned in `apps/web` and runs through pnpm in CI only. Runbook: `docs/runbooks/deploy-and-rollback.md`.

## Docs map

- `docs/architecture.md` — goals, layout, runtimes, quality targets, mission table
- `docs/tool-contract.md` — the contract every tool follows (draft until Mission 8)
- `docs/design-system.md` — the Signal design system: how to use tokens and components
- `docs/adr/` — one file per architecture decision
- `docs/runbooks/` — step-by-step procedures (deploy and rollback)

## Changing a decision

A decision changes only through a new ADR that supersedes the old one. Update this file in the same branch.

## Windows note

The owner's machine is Windows 10. Shell commands run in Git Bash.
