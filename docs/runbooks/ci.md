# CI: what runs where

Workflow: `.github/workflows/ci.yml`. Decisions: ADR 0025, 0027, 0054, 0055.

## What runs where

| Event | What runs |
| --- | --- |
| Pull request, tool-only | `scope`, `quality`, `supply-chain`, `lockfile`, E2E of the changed tools' specs plus every shared spec in 3 browsers, Lighthouse on the changed tools' pages, then `preview` |
| Pull request, anything else | The same, with the full E2E suite and Lighthouse on every page |
| Push to `main` | `scope`, `quality`, `supply-chain`, E2E (skipped, scoped or full), Lighthouse on every page, then `deploy`, then `verify-production` after every successful deploy |
| Manual (`workflow_dispatch`) | The full suite: every spec, 3 browsers, every page. It never previews or deploys |

Tool-only means every changed file is under `tools/<category>/<tool-id>/`, or is `apps/web/e2e/<tool-id>.spec.ts` of a changed tool, with status added, modified or changed. Anything else, an unknown file, a rename, a removal, a merge commit, 3,000 or more files, or any error in `scripts/ci-scope.ts` runs the full suite.

A shared spec is a spec in `apps/web/e2e/` that is not named after a tool id (`search`, `seo`, `budgets`, `headers`, and so on). Shared specs always run.

## E2E jobs

`e2e-chromium`, `e2e-firefox` and `e2e-webkit` run in parallel, 40 minutes each. The `e2e` job is the gate: it passes only when all three did, and then uploads `e2e-passed-full-<tree>` or `e2e-passed-scoped-<tree>`.

On `main`:

- a full run is skipped only for a `full` artifact of the same tree;
- a scoped run is skipped for a `scoped` or a `full` artifact of the same tree;
- `deploy` accepts a skipped `e2e` only when `scope` succeeded and said so.

Shard the browser jobs when a measured browser job passes 25 minutes. The numbers are in the job summaries of the Actions tab.

## Run the full suite by hand

On GitHub: Actions, CI, Run workflow, pick the branch. Or:

```sh
gh workflow run CI --ref <branch>
```

Locally, from the repo root: `pnpm test:e2e` (all specs, all browsers). One tool: `pnpm build`, then `pnpm --filter web exec playwright test --project=chromium e2e/<tool-id>.spec.ts`.

## Billed minutes

Measured: run 36675813325 (a tool pull request, one `e2e` job of 33 minutes, 46 in all). Everything else is ESTIMATED, from about 3 minutes of setup per browser job, about 10 minutes of tests per browser at 12 tools (shared 5.8 + 0.1 per tool, tool specs 0.25 per tool), and Lighthouse of (110 s + 19 s per page) / 60.

| Run | 12 tools | 50 tools | 100 tools |
| --- | --- | --- | --- |
| Tool-only pull request | 43 | 52 | 67 |
| Non-tool pull request | 54 | 106 | 173 |
| Full run on `main` | 54 | 106 | 173 |

Replace these with measured numbers as runs happen. Lighthouse's 30-minute timeout is estimated to be reached at about 90 tools on a full run.
