# 0011. Tests: Vitest, Playwright, Lighthouse CI

Status: Accepted
Date: 2026-09-19

## Context

Every tool requires tests, and speed targets need automated checks.

## Decision

Use Vitest, Playwright and Lighthouse CI.

Vitest was set up in Mission 3 (2026-09-20):

- `vitest` 4.1.11 is a root devDependency at an exact version. Its peer range (`vite: ^6.0.0 || ^7.0.0 || ^8.0.0`) officially supports the repo's Vite 8.3.0. Vitest 5.0.1 was the latest release, but 4.1.11 is used instead. Revisit Vitest 5 once Astro's testing docs confirm support.
- A root `vitest.config.ts` uses `test.projects: ["apps/*", "packages/*"]`, so every workspace with its own `vitest.config.ts` becomes a project as the repo grows.
- `apps/web/vitest.config.ts` wraps the config in Astro's `getViteConfig`, with `root` pinned to `apps/web` because Vitest runs from the repo root. Tests are colocated as `src/**/*.test.ts`.
- `passWithNoTests` is not set. A run that finds no tests fails.
- First test: `apps/web/src/layouts/Base.test.ts` renders `Base.astro` with Astro's Container API (`experimental_AstroContainer`) and asserts `<html lang="en">`, a charset meta, the viewport meta, and that the title and description props appear in the output.
- `pnpm test` runs `vitest run`.

Mission 4 (2026-09-20) made three changes to the Vitest setup:

- The root config was renamed from `vitest.config.mts` to `vitest.config.ts`, and the root `package.json` now has `"type": "module"`.
- `@types/node` 24.13.5 (the latest 24.x that passed `minimumReleaseAge`) was added to `apps/web`, so the local `ImportMeta.dirname` declaration was removed.
- `apps/web/vitest.config.ts` excludes `e2e/**`. E2E specs are named `*.spec.ts`, so Vitest cannot pick them up by accident.

Playwright was added in Mission 4. The decision is in ADR 0026, and it runs in CI (ADR 0025). Lighthouse CI is not set up yet.

## Consequences

Each tool has a required logic.test.ts. Performance is checked in CI. `pnpm check` runs the tests after the type check and lint. The Container API is still exported as `experimental_AstroContainer`, so it may change in a future Astro release.

## Revisit when

Astro's testing docs confirm Vitest 5 support (then move from 4.1.11), or the Container API loses its `experimental_` prefix.
