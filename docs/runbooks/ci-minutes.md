# Runbook: CI minutes

Why: [ADR 0053](../adr/0053-ci-minutes-for-tool-prs.md). GitHub Free gives 2,000 Actions minutes a month, shared across every repository the owner has; it ran out on 2026-09-29.

## What runs where

| Trigger | `quality`, `supply-chain`, `lockfile`, `lighthouse`, `preview` | `e2e` browsers |
| --- | --- | --- |
| Pull request, tool-only diff (only `tools/**`, `docs/**`, and the matching `apps/web/e2e/*.spec.ts`) | run as always | Chromium only |
| Pull request, anything else changed (shared components, security, PWA, runtime, config, CI, dependencies) | run as always | Chromium, Firefox, WebKit |
| Push to `main` | run as always, plus `deploy` and `verify-production` | Chromium, Firefox, WebKit |

The `changes` job in `.github/workflows/ci.yml` decides tool-only with a plain `git diff --name-only` against the pull request's base SHA. It runs only on `pull_request`, so a push to `main` is never affected.

## Real minutes (PR #36, "Color Converter", a tool-only PR, measured 2026-09-30)

| Job | Before (3 browsers) |
| --- | --- |
| quality | 1:49 |
| supply-chain | 0:40 |
| lockfile | 0:01 |
| e2e | 32:01 |
| lighthouse | 6:21 |
| preview | 0:39 |
| **Total** | **~41.5 min** |

`e2e` on Chromium alone is expected at roughly a third of 32 minutes plus fixed install/build overhead — on the order of 20 fewer minutes per tool pull request. Confirm the real number from the first tool PR run after this change lands (`gh run view <run-id> --json jobs`) and update this table.

## Switch back to 3 browsers on every pull request

Required before Mission 18 (`docs/launch-checklist.md`):

1. Delete the `changes` job from `.github/workflows/ci.yml`.
2. Change `e2e`'s `needs` back to `quality` and drop its `if: always() && needs.quality.result == 'success'` line.
3. Replace the conditional "Install Playwright browsers" / "Run Playwright tests" steps with the original unconditional `pnpm --filter web exec playwright install --with-deps` and `pnpm test:e2e`.
