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

Safety:
- Never commit secrets or `.env` files.
- No global installs and no global config changes.

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
- `pnpm check` — type check (`astro check`)

## Docs map

- `docs/architecture.md` — goals, layout, runtimes, quality targets, mission table
- `docs/tool-contract.md` — the contract every tool follows (draft until Mission 8)
- `docs/adr/` — one file per architecture decision

## Changing a decision

A decision changes only through a new ADR that supersedes the old one. Update this file in the same branch.

## Windows note

The owner's machine is Windows 10. Shell commands run in Git Bash.
