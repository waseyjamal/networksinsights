# 0053. Fewer CI minutes on tool-only pull requests

Status: Accepted
Date: 2026-10-01

## Context

GitHub Free gives 2,000 Actions minutes a month for private repositories, shared across every repository the owner has. It ran out on 2026-09-29. The owner will not pay for more minutes and will not make the repository public.

A single tool pull request (for example PR #36, "Color Converter", which touched only `tools/color-design/color-converter/**` and its own `apps/web/e2e/color-converter.spec.ts`) ran `quality` 1:49, `supply-chain` 0:40, `lockfile` 0:01, `e2e` 32:01, `lighthouse` 6:21 and `preview` 0:39 — about 41.5 minutes of job time. `e2e` is almost all of that, because `playwright.config.ts` already runs three projects (`chromium`, `firefox`, `webkit`) on every pull request, and a tool pull request's own `logic.test.ts` already proves its logic in Vitest before `e2e` ever runs.

Most pull requests opened against this repository are exactly this shape: one new tool folder, its own e2e spec, maybe a docs change. They touch no shared component, no security header, no runtime, no CI file and no dependency.

## Decision

A new `changes` job runs on `pull_request` only (never on `push`, so every merge to `main` is unaffected). It runs a plain `git diff --name-only` between the PR's base and head SHA — no third-party action — and classifies the pull request as **tool-only** when every changed file is under `tools/`, under `docs/`, or is itself an `apps/web/e2e/*.spec.ts` file, and at least one `tools/` file changed. Anything else in the diff — a shared component, `apps/web/src/**` outside an e2e spec, security, PWA, runtime, config, `package.json`, the lockfile, or `.github/**` — makes the pull request not tool-only.

When the pull request is tool-only, the `e2e` job installs and runs Playwright's `chromium` project only (`pnpm test:e2e -- --project chromium`). Every other pull request, and every push to `main`, still installs and runs all three browsers, unchanged.

`quality`, `supply-chain`, `lockfile`, `lighthouse` and `preview` are untouched: the mission asked for `e2e`'s browser scope to change, not what runs. `preview` still needs `e2e` to succeed, regardless of which browsers it ran.

Concurrency was already `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`, scoped per workflow and ref, and already never cancels a run on `main` (ADR 0027 note in `ci.yml`); nothing changed there.

Dependabot (`.github/dependabot.yml`) was already weekly and grouped (ADR 0049); nothing changed there either.

## Consequences

- Good: a tool-only pull request's `e2e` job is expected to drop from ~32 minutes to roughly a third of that (Chromium alone, plus fixed install/build overhead), saving on the order of 20 minutes of job time per tool PR — the majority of that PR's total CI minutes.
- Good: the classification is a plain shell diff with no new dependency, no new permission, and fails safe: anything it cannot confidently call tool-only runs all three browsers.
- Good: a push to `main` is never affected, so what ends up live has always been checked on Chromium, Firefox and WebKit.
- Cost: a tool pull request's CI run no longer proves the tool page works in Firefox or WebKit before merge. A bug specific to one of those engines surfaces only after merge, in the `push` run on `main`, or not until a later pull request that happens to touch shared code.
- Cost: the tool-only rule is a heuristic on file paths, not on what the e2e spec actually exercises. A tool pull request that happens to also need a shared-component change correctly loses the shortcut (it is no longer tool-only), but a tool whose single spec quietly depends on browser-specific behavior elsewhere would not be caught by this rule.

## Switch back

Before Mission 18 (see `docs/launch-checklist.md`), remove the shortcut so every pull request runs all three browsers again, same as a push to `main`:
- Delete the `changes` job from `.github/workflows/ci.yml`.
- Change `e2e`'s `needs` back to `quality` and drop the `if: always() && needs.quality.result == 'success'` line (plain `needs: quality` already skips `e2e` when `quality` fails).
- Replace the "Install Playwright browsers" and "Run Playwright tests" conditional steps with the original unconditional `pnpm --filter web exec playwright install --with-deps` and `pnpm test:e2e` steps.

## Revisit when

- The owner is willing to pay for more Actions minutes, or the repository becomes eligible for a larger free allowance: remove the shortcut early.
- A bug ships that only Firefox or WebKit would have caught on a tool pull request: tighten the tool-only rule, or remove the shortcut, before Mission 18 rather than waiting for it.
