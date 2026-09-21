# 0024. Git hooks

Status: Accepted
Date: 2026-09-20

## Context

Lint, type and test failures should be caught before code leaves the developer's machine, for humans and AI agents alike.

## Decision

Use husky 9.1.7 (root devDependency, exact version). It is installed by the root `prepare` script, so `pnpm install` sets up the hooks. husky points `core.hooksPath` at `.husky/_` in this repository's local git config only.

- `pre-commit` runs `pnpm exec biome check --staged --no-errors-on-unmatched`: Biome on staged files only, with no writes.
- `pre-push` runs `pnpm check`: type check, then lint, then tests, stopping at the first failure.

## Consequences

- A commit with a lint or format error is blocked. A push with a failing type check, lint or test is blocked.
- `biome check --staged` reads each staged file from disk, so a partially staged file is checked as a whole.
- Hooks are local and can be skipped with `--no-verify`, so they are not the last line of defence. CI (Mission 4) must run `pnpm check` too.
- Where hooks are not wanted, such as CI installs, husky is turned off with `HUSKY=0`.

## Amendment (Mission 10)

The pre-push hook runs `pnpm check`, which now leaves the slow tests to CI: see [ADR 0043](0043-test-tiers-and-agent-safe-e2e.md).

## Revisit when

Hooks become too slow, or CI makes the pre-push check redundant.
