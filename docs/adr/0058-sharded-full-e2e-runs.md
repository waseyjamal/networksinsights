# 0058. Full E2E runs in three shards per browser

Status: Accepted
Date: 2026-10-02

Amends [ADR 0055](0055-scoped-e2e-and-per-browser-jobs.md) (decision 2, one job per browser). Does not change [ADR 0026](0026-e2e-testing.md) or the artifact rules of ADR 0055: every test still runs in Chromium, Firefox and WebKit whenever the full suite runs.

## Context

Run 37000596636 (pull request #46, 32 tools, the full suite of 737 tests per browser in one job each) took 33 minutes in Chromium and 39 in Firefox, and WebKit was cancelled by the 40-minute timeout after about 532 test runs. One broken test assumption made every page's `csp.spec` test fail twice (about 20 minutes per browser), but the suite also grows with every tool. Each tool adds its own spec, and `csp.spec` and `site.spec` loop over every page: `csp.spec` alone is 104 tests per browser at 32 tools, 2 more per tool.

Measured test minutes in that run, per browser: shared specs other than `csp.spec` 4.1 (Chromium), 4.7 (Firefox), 2.2 (WebKit, partial); tool specs 5.4, 6.0 and 12.1 (WebKit, partial).

## Decision

1. **A full run splits each browser into 3 Playwright shards**: `e2e-<browser>-<1..3>`, 9 jobs, `playwright test --shard=<n>/3`. Playwright divides the tests between the shards with no overlap, so the 3 shards of a browser run every test once.
2. **A scoped run stays at 1 job per browser** (`e2e-<browser>-1`, `--shard=1/1`). It runs the changed tools' specs plus every shared spec, estimated at about 10 minutes per browser at 32 tools and about 21 at 100 tools, under 25.
3. The workflow derives the shard count from `scope`'s `e2e_mode`: `scoped` gives 1, anything else gives 3. That includes an empty value when `scope` itself failed, so a failed `scope` still runs everything.
4. **The `e2e` gate needs every job that ran.** The result of the matrix job is `success` only when all of its jobs succeeded. The `full` and `scoped` artifact rules of ADR 0055 are unchanged: a scoped artifact never lets a full run be skipped.
5. Each job keeps the 40-minute timeout as a backstop; a shard is meant to stay under 25 minutes.

**When to add shards:** when any measured E2E job, sharded or scoped, passes 25 minutes, raise that run type's shard count by one, in a new ADR.

## Consequences

- Setup (install, browser, build, about 1.5 minutes) is paid by each of 9 jobs on a full run instead of 3, about 9 more billed minutes. In return no job nears its timeout, and wall-clock time falls to the slowest shard.
- The minute table in `docs/runbooks/ci.md` gives the measured numbers of run 37000596636 and the estimates for 32, 50 and 100 tools.
