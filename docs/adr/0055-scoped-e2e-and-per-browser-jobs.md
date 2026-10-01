# 0055. Scoped E2E, one job per browser, and verify-production after every deploy

Status: Accepted
Date: 2026-10-01

Amends [ADR 0054](0054-ci-scope-and-tree-skip.md) (decisions 3 and 5) and [ADR 0025](0025-ci-pipeline.md) (the `e2e` job). Does not change [ADR 0026](0026-e2e-testing.md): every test still runs in Chromium, Firefox and WebKit whenever the full suite runs, and no test is removed or weakened.

## Context

After ADR 0054, a tool pull request still ran the whole E2E suite, about 70 percent of its billed minutes, in one job with a 35-minute limit. That job grows with every tool and would hit the limit at about 15 tools. Run #87 on `main` also showed a bug: `deploy` succeeded after a skipped `e2e`, and `verify-production` was skipped. It has `needs: deploy` and an `if:` with no status check function, so GitHub adds an implicit `success()`, which is false when an ancestor job (`e2e`) was skipped. The GitHub documentation states only the default (`success()` applies unless the `if:` has a status function). The behaviour was reproduced on a scratch branch on 2026-10-01: with the old pattern the job after a succeeded deploy was skipped, and with `!cancelled() && needs.deploy.result == 'success'` it ran, and it did not run after a failed or a skipped deploy.

## Decision

1. **Scoped E2E.** A pull request or a push to `main` that is tool-only (the ADR 0054 rule, read from the pull request files, or from the pushed commit's files when it has exactly one parent) runs, in all three browsers, the spec files of the changed tools plus every shared spec. A shared spec is any file in `apps/web/e2e/` whose name is not an existing tool id; a spec with an unknown name counts as shared. Any other change, any unknown file, any rename or removal, a merge commit, a truncated list and any error in the script run the full suite. A manual run (`workflow_dispatch`) is always full and never deploys.
2. **One job per browser.** `e2e-chromium`, `e2e-firefox` and `e2e-webkit` run in parallel, each with a 40-minute timeout. A gate job named `e2e` (the name ADR 0025 fixes) passes only when all three passed. Shard the browser jobs, or raise the timeout in a new ADR, when a measured browser job passes 25 minutes.
3. **Labelled artifacts.** The gate uploads `e2e-passed-full-<tree>` or `e2e-passed-scoped-<tree>`, by what ran. On `main`, a full run is skipped only for a "full" artifact of the same tree; a scoped run is skipped for a "scoped" or a "full" one. Unlabelled `e2e-passed-<tree>` artifacts from ADR 0054 are ignored. The artifact checks of ADR 0054 (live, this repository, not a fork) are unchanged.
4. **verify-production** runs after every successful deploy, including after a skipped E2E: `if: !cancelled() && needs.deploy.result == 'success' && push to main`.
5. **Lighthouse timeout** is 30 minutes, because a full run measures every page and the catalog grows.

## Consequences

- Splitting adds setup (install, browser, build) three times, so a full run bills more minutes than before (estimated about 40 against 33 at 12 tools) but takes about a third of the wall-clock time. Tool-only changes bill less as the catalog grows, because tool specs are most of the growth.
- The table of estimates for 12, 50 and 100 tools is in `docs/runbooks/ci.md`; only the 12-tool inputs are measured.
- A scoped artifact never lets a full run be skipped, so a tool-only pull request cannot hide an untested change on `main`.

## Revisit when

- A measured browser job passes 25 minutes (shard it).
- The repository goes public or moves to a paid plan, and minutes no longer matter.
