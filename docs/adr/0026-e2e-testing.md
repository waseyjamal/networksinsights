# 0026. E2E testing

Status: Accepted
Date: 2026-09-20

## Context

Unit tests cannot show that a built page works in a real browser: that the HTML is complete, that the React island hydrates, and that nothing logs errors. The site targets all major browser engines.

## Decision

Use Playwright (`@playwright/test` 1.63.0, Apache-2.0, exact version, an `apps/web` devDependency). It is the E2E part of ADR 0011.

- Config: `apps/web/playwright.config.ts`. Tests: `apps/web/e2e/*.spec.ts`.
- Three projects, one per engine: chromium, firefox and webkit.
- Tests run against the production build served by `astro preview`, started by Playwright's `webServer` on `127.0.0.1:4321`. They never run against the dev server.
- Root script `pnpm test:e2e` builds first, then runs Playwright. The build step means the tests always see the current code, both locally and in CI.
- Smoke scope, on the home page only: the response status is 200; the `<h1>` is visible; the React island shows "Interactive: yes"; there are no console errors or uncaught page errors; the page has a non-empty `<title>` and a non-empty meta description.
- In CI: one retry, `forbidOnly`, and an HTML report with traces on first retry. Locally: no retries, list reporter.
- `test:e2e` is not part of `pnpm check` or the pre-push hook because it is too slow. It runs in CI (job `e2e`, ADR 0025) and on demand.
- Vitest does not pick up E2E files: its `include` is `src/**/*.test.ts`, it excludes `e2e/**`, and E2E files use `.spec.ts`.
- Browsers download into Playwright's standard cache (`%LOCALAPPDATA%\ms-playwright` on Windows), outside the repo. One-time setup: `pnpm --filter web exec playwright install`. All three engines installed and passed on Windows 10.
- `playwright-report/` and `test-results/` are git-ignored.

## Amendments

- **Mission 10.** `playwright.config.ts` sets `ASTRO_PREVIEW_BACKGROUND` so `pnpm test:e2e` works when a coding agent runs it: see [ADR 0043](0043-test-tiers-and-agent-safe-e2e.md).

- **Local workers (Mission 7).** Locally Playwright runs with at most 2 workers (`...(process.env.CI ? {} : { workers: 2 })` in `playwright.config.ts`). A full run starts three browser engines, and at the default worker count it used enough memory that the operating system stopped the run. CI keeps Playwright's default. If 2 workers is still too many on a machine, lower it there and do not raise it in the repo.
- **Scope has grown since this ADR.** The suite is no longer smoke tests on the home page only. Missions 6 and 7 added specs for the design system, budgets, every page in light and dark (status, one H1, console errors, axe, noindex, title), keyboard use, and a link and metadata check over the built site. Those specs are listed in `docs/design-system.md`. The React island of the smoke scope no longer exists on the home page.
- **Trailing slashes.** URLs end in a slash (`trailingSlash: "always"`, ADR 0030), so specs use the canonical form (`/tools/`, `/unknown/`), because `astro preview` serves the 404 page for the canonical form only.
- **WebKit and the Tab key.** Safari does not put links in the Tab order by default, and Playwright's WebKit matches it. The Tab-order check of the header runs in chromium and firefox; in WebKit the same controls are focused directly and the rest of the keyboard behavior (Enter, Space, arrow keys) is still tested.

## Consequences

- Each of the three engines runs 5 smoke tests, so 15 tests in total. A run takes about 30 seconds after the build.
- Every new tool page will need its own E2E spec, or a shared parametrised one, once the tool contract exists (Mission 8).
- Browsers are large downloads (hundreds of MB) on a developer's machine and on every CI run.
- Playwright releases often, and browser versions move with it. Dependabot for npm arrives in Mission 12.

## Revisit when

The E2E suite becomes too slow for CI (then shard it or run engines as separate jobs), or a tool needs a browser feature that one of the three engines does not have.
