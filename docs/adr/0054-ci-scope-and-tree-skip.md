# 0054. CI scope: Lighthouse on changed tool pages, and no repeat E2E for a tree that already passed

Status: Accepted
Date: 2026-10-01

Amended by [ADR 0055](0055-scoped-e2e-and-per-browser-jobs.md) (decisions 3 and 5: labelled artifacts, one E2E job per browser, scoped E2E). Amends [ADR 0025](0025-ci-pipeline.md) (what CI runs) and [ADR 0027](0027-deployment.md) (what gates a deploy). Does not change [ADR 0052](0052-pwa-service-worker-and-lighthouse-budgets.md): the budgets, the page list and the three runs per page stay.

## Context

The repository is private, so Actions minutes are billed on the free plan. Each job is billed in whole minutes. Measured on 2026-10-01 from the job durations of real runs (`gh api repos/<repo>/actions/runs/<id>/jobs`):

| Run | supply-chain | lockfile | quality | e2e | lighthouse | preview or deploy | verify | Billed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tool PR, Color Converter, run 36675813325 | 1 | 1 | 3 | 33 | 7 | 1 | skipped | 46 |
| Push to main, run 36671451532 | 1 | skipped | 3 | 31 | 6 | 1 | 1 | 43 |
| Push to main, run 36822774370 | 1 | skipped | 3 | 32 | 7 | 1 | 1 | 45 |

E2E is about 70 percent of every run. Every test and every browser (Chromium, Firefox, WebKit) must keep running; this ADR removes no test.

Checked against the current GitHub documentation on 2026-10-01 (Dependency caching reference): a cache made by a pull request run is created for the merge ref (`refs/pull/N/merge`) and "can only be restored by re-runs of the pull request". A run on `main` cannot read it. A cache therefore cannot carry "this tree passed E2E" from a pull request to `main`.

## Decision

1. **A `scope` job** (`scripts/ci-scope.ts`, Node built-ins only, unit-tested) runs first and decides how much a run needs. It runs with plain `node` and installs nothing.
2. **Lighthouse on tool pull requests.** The script asks the GitHub pull request files API for the changed files. The pull request counts as tool-only only if every file is `tools/<category>/<tool-id>/...` with status added, modified or changed, or is `apps/web/e2e/<tool-id>.spec.ts` of a tool that is also changed. `pnpm new:tool` writes only the tool folder; the per-tool E2E spec is the one other file past tool pull requests (#35, #36) touched. Lighthouse then measures only `/<tool-id>/` for each changed tool. Every other pull request, and every run on `main`, measures every page.
3. **No repeat E2E on `main` for a tree that already passed.** The E2E job, after the tests pass, uploads a tiny artifact named `e2e-passed-<tree hash>`, where the hash is `git rev-parse HEAD^{tree}` of what it tested. Artifacts, unlike caches, are readable from any branch. On a push to `main`, `scope` computes the tree hash and asks the artifacts API for that name. E2E is skipped only if a non-expired artifact exists whose workflow run belongs to this repository and not to a fork. A tree hash covers every file, workflow files included, so an identical hash means identical code. Pull requests never skip E2E.
4. **Fail safe.** `scope` answers "everything" (all pages, E2E on) for an empty, truncated (3,000 files or more), malformed or unknown file list, any renamed or removed file, any path outside the rule, any API or git error, or an unknown artifact answer. If the `scope` job itself fails, `e2e` and `lighthouse` still run in full.
5. **Deploy gate.** `deploy` needs `quality`, `supply-chain` and `lighthouse` to succeed. A skipped `e2e` counts only when `scope` succeeded and its own output says `skip_e2e == 'true'`. If `scope` failed or was skipped, nothing deploys.

The artifact is written by a job that runs only after the E2E step passed, with `retention-days: 30`. After 30 days the artifact expires, and the next push to `main` with that tree runs E2E again.

## Consequences

- A run on `main` whose tree already passed E2E bills about 11 to 13 minutes instead of 43 to 45, saving about 31 to 33. The match needs the pull request's last E2E run to have tested the tree that lands on `main`. In the five most recent merged pull requests (#32 to #36), the tree on `main` equals the pull request head's tree, and CI tests that tree when the pull request is up to date with `main`. If `main` moved after the last push, the trees differ and E2E runs again. That is the safe outcome, not an error.
- A tool-only pull request bills about 3 minutes of Lighthouse instead of 7, plus 1 for `scope`. The estimate assumes about 110 seconds of install and build and about 19 seconds per page; it is not measured. Of #20, #21, #34, #35 and #36, only #35 and #36 would be tool-only: #20 and #21 changed shared code and #34 added a design-system component.
- Pull requests keep the full E2E suite, so a tool pull request saves little. Most savings come from `main`.
- One extra job, `scope`, about 1 billed minute on every run.
- The artifact is proof only as far as the repository's own workflow is trusted. Anyone who can push a branch to this repository could upload one. The check refuses artifacts from forks. Write access to this repository already allows much more than that.

## Revisit when

- The catalog grows and the one-page Lighthouse run for a tool pull request is itself slow (ADR 0052 already notes that page count drives Lighthouse time).
- The repository goes public (Actions minutes are then free), or moves to a paid plan, and the saving no longer matters.
- Merges to `main` are no longer squash merges of an up-to-date branch, which would make tree matches rare.
