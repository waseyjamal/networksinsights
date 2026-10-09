# CI: what runs where

Workflow: `.github/workflows/ci.yml`. Decisions: ADR 0025, 0027, 0054, 0055, 0058, 0063.

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

A full run splits each browser into 3 Playwright shards: `e2e-chromium-1` to `e2e-webkit-3`, 9 jobs, each `--shard=<n>/3` (ADR 0058). A scoped run is 1 job per browser: `e2e-chromium-1`, `e2e-firefox-1`, `e2e-webkit-1`. The shard count comes from `scope`'s `e2e_mode`; when `scope` fails, the run is full, in 3 shards. Every job has a 40-minute timeout as a backstop. The `e2e` job is the gate: it passes only when every job that ran passed, and then uploads `e2e-passed-full-<tree>` or `e2e-passed-scoped-<tree>`.

To check locally that the shards cover every test once: `pnpm --filter web exec playwright test --list --project=chromium --shard=1/3` (then 2/3 and 3/3) and compare with the list without `--shard`.

On `main`:

- a full run is skipped only for a `full` artifact of the same tree;
- a scoped run is skipped for a `scoped` or a `full` artifact of the same tree;
- `deploy` accepts a skipped `e2e` only when `scope` succeeded and said so.

**Rule:** when any measured E2E job, sharded or scoped, passes 25 minutes, add one shard to that run type (a new ADR). The durations are on the run page of the Actions tab.

## Lighthouse jobs

A full run splits the key pages into 6 shards, `lighthouse-1` to `lighthouse-6`, each `pnpm check:lighthouse --shard <n>/6` (ADR 0063). The `lighthouse` job is the gate: it passes only when every expected shard passed, and fails on a failed, cancelled, skipped or missing shard, naming the shard and the pages.

| Event | Lighthouse |
| --- | --- |
| Push to `main` | All 6 shards, every page, even when E2E is skipped |
| Pull request, tool-only | 1 job, `lighthouse-1`, only the changed tools' pages |
| Pull request, anything else | All 6 shards |
| Manual run (`workflow_dispatch`) | All 6 shards |
| `scope` failed | All 6 shards |

MEASURED, run 37255844478 (main, 62 tools, one job, before sharding): 24 minutes 7 seconds, 65 pages, about 21 seconds a page. ESTIMATED per shard: about 6 minutes at 62 tools, 11.5 at 150. Each shard has a 20-minute timeout as a backstop.

To run one shard locally: `pnpm build`, then `pnpm check:lighthouse --shard 1/6`.

**Rule:** when any measured Lighthouse shard passes 12 minutes, add one shard (a new ADR).

## A job stalls during Playwright install

A red job whose log shows `Ign` lines, or "The operation was canceled" during `playwright install`, is the
package mirror stalling, not the change. Use **Re-run failed jobs** once. If it fails the same way again, wait
and re-run later.

## Run the full suite by hand

On GitHub: Actions, CI, Run workflow, pick the branch. Or:

```sh
gh workflow run CI --ref <branch>
```

Locally, from the repo root: `pnpm test:e2e` (all specs, all browsers). One tool: `pnpm build`, then `pnpm --filter web exec playwright test --project=chromium e2e/<tool-id>.spec.ts`.

## Billed minutes

GitHub bills each job rounded up to the whole minute. `gh repo view` showed the repository as public on 2026-10-09; the billed-minutes limit matters again if it goes private.

MEASURED, run 37000596636 (pull request #46, 32 tools, full suite, one job per browser, before sharding; the e2e jobs were slowed by about 20 minutes each by one failing `csp.spec` assumption, and WebKit was cancelled at its 40-minute timeout): lockfile 1, scope 1, supply-chain 1, quality 3, lighthouse 14, e2e-chromium 34, e2e-firefox 40, e2e-webkit 41, e2e gate 1: **136 minutes**. Test minutes per browser in that run: shared specs other than `csp.spec` 4.1 / 4.7 / 2.2 (Chromium / Firefox / WebKit, partial), tool specs 5.4 / 6.0 / 12.1 (WebKit partial). Job setup before the first test: about 1.2 minutes.

ESTIMATED, with sharding (ADR 0058): fixed jobs 7 (measured), Lighthouse 14 for a full run at 32 tools (measured) plus about 0.4 per tool, about 2 for one tool page; E2E per browser about 1.5 setup per job, `csp.spec` about 3.5 when passing, and per added tool about 0.33 (Chromium), 0.35 (Firefox) and 0.66 (WebKit) minutes.

| Run | 32 tools | 50 tools | 100 tools |
| --- | --- | --- | --- |
| Tool-only pull request (scoped, 1 job per browser) | 40 ESTIMATED | 49 ESTIMATED | 73 ESTIMATED |
| Non-tool pull request (full, 3 shards per browser) | 86 ESTIMATED | 117 ESTIMATED | 202 ESTIMATED |
| Full run on `main` (3 shards per browser) | 86 ESTIMATED | 117 ESTIMATED | 202 ESTIMATED |
| Full run, before sharding (run 37000596636) | 136 MEASURED | | |

MEASURED at 100 tools (`gh run view`, wall time from job start to end):

- Run 37775145082, pull request #67, tool-only (scoped): scope 0.1, lockfile 0.1, supply-chain 0.7, quality 4.2, lighthouse-1 1.7, e2e-chromium-1 8.2, e2e-firefox-1 12.0, e2e-webkit-1 15.5 minutes.
- Run 37820220168, push to `main` (E2E skipped by tree): quality 4.6, supply-chain 1.2, lighthouse-1 to 6 between 6.1 and 8.6 minutes, deploy 1.0, verify-production 0.7.
- Full E2E shards (3 per browser) at 100 tools: to re-measure; no full run at 100 tools was checked.

Replace the estimates with measured numbers as runs happen. At about 100 tools a WebKit shard is estimated near 22 minutes, check it against the rule above. Lighthouse is sharded since ADR 0063, so its estimates above are for one job.
