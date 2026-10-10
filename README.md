# NetworksInsights

NetworksInsights.com is a free online tools platform. It starts at 500+ tools and grows without limit. Every tool is a plugin that follows one contract, and pages are static HTML first for speed and search.

## Requirements

- Node.js 24.x
- pnpm 11.27.0

## Commands

Run from the repo root:

- `pnpm install` — install dependencies
- `pnpm dev` — start the dev server
- `pnpm build` — build for production
- `pnpm preview` — preview the production build
- `pnpm lint` — Biome check, no writes
- `pnpm fix` — Biome check with safe fixes written
- `pnpm typecheck` — type-check the SDK, the scripts, the tools and the web app
- `pnpm test` — run the tests
- `pnpm check` — typecheck, lint, test and check the tools, stopping at the first failure
- `pnpm new:tool` — create a new tool folder ([docs/adding-a-tool.md](docs/adding-a-tool.md))
- `pnpm check:tools` — run every tool gate; `--tool <id>` checks one tool, `--json` prints JSON
- `pnpm check:budgets` — measure each tool page's JavaScript against its budget (run after `pnpm build`)
- `pnpm test:e2e` — build, then run the Playwright E2E tests

## Documentation

- [AGENTS.md](AGENTS.md) — rules for every AI coding agent
- [docs/architecture.md](docs/architecture.md) — goals, layout, runtimes, mission table
- [docs/tool-contract.md](docs/tool-contract.md) — the contract every tool follows
- [docs/adding-a-tool.md](docs/adding-a-tool.md) — how to add a tool, and the prompt to give an AI agent
- [docs/adr/](docs/adr/) — architecture decision records
- [docs/launch-checklist.md](docs/launch-checklist.md) — every owner input and step needed before launch
- [docs/owner-guide.md](docs/owner-guide.md) — plain guide for the owner: project state, dated duties, CI, merging
- [docs/runbooks/deploy-and-rollback.md](docs/runbooks/deploy-and-rollback.md) — how deploys work and how to roll back
