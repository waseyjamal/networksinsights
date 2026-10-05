# 0063. Full Lighthouse runs in six shards

Status: Accepted
Date: 2026-10-05

Amends [ADR 0055](0055-scoped-e2e-and-per-browser-jobs.md) (decision 5, the Lighthouse timeout). Does not change [ADR 0052](0052-pwa-service-worker-and-lighthouse-budgets.md): every key page is still measured on the mobile profile, judged on the median of 3 runs, against the same LCP, CLS and TBT budgets.

## Context

Run 37255844478 (push to main, 62 tools) measured 65 pages in one `lighthouse` job: 24 minutes 7 seconds, of which 22.8 minutes were Lighthouse, about 21 seconds a page, and about 1.5 minutes setup. The job has a 30-minute timeout and has grown from about 12 minutes as tools were added. The repository is public, so billed minutes no longer limit CI; wall-clock time and the timeout do.

## Decision

1. **A full run splits the key pages into 6 shards**: jobs `lighthouse-1` to `lighthouse-6`, each `pnpm check:lighthouse --shard <n>/6`. `shardPages` sorts the pages and gives page k to shard (k mod 6) + 1, so the shards hold every page exactly once and differ by at most one page. A new tool takes its alphabetical place; later pages may move shard, none is left out. Unit tests prove the cover.
2. **What runs where:**

   | Event | Lighthouse |
   | --- | --- |
   | Push to `main` | All 6 shards, every page, even when E2E is skipped |
   | Pull request, tool-only | 1 job, `lighthouse-1`, only the changed tools' pages |
   | Pull request, anything else | All 6 shards |
   | Manual run (`workflow_dispatch`) | All 6 shards |
   | `scope` failed | All 6 shards |

   Only a pull request ever narrows `lighthouse_pages` (`scripts/ci-scope.ts`); an empty list means every page in 6 shards.
3. **The gate keeps the name `lighthouse`** (ADR 0025), so `preview` and `deploy` are unchanged. It expects 1 job when `lighthouse_pages` is set and 6 otherwise, and `scripts/lighthouse-gate.ts` passes only when the matrix result is `success` and every expected shard uploaded a summary with no page over budget. A failed, cancelled, skipped or missing shard fails it, and it prints the shard and the failing pages. Unit tests cover all success, one failed, one cancelled and one missing shard.
4. Each shard keeps its HTML and JSON reports as `lighthouse-report-<n>`. Each shard job has a 20-minute timeout as a backstop; a shard is meant to stay under 12 minutes.

**When to add shards:** when any measured Lighthouse shard passes 12 minutes, raise the shard count by one, in a new ADR.

## Consequences

- Estimated per shard: about 11 pages and 6 minutes at 62 tools; about 26 pages and 11.5 minutes at 150 tools, both under 12.
- Setup (install, Chromium, build, about 1.5 minutes) is paid 6 times on a full run. Free on a public repository; it counts again if the repository goes private.
- Reports are spread over 6 artifacts; the gate reads only the small summaries.
