# 0043. Test tiers and agent-safe E2E

Status: Accepted
Date: 2026-09-21

Amends [ADR 0024](0024-git-hooks.md) (hooks), [ADR 0025](0025-ci-pipeline.md) (CI) and [ADR 0026](0026-e2e-testing.md) (E2E).

## Context

Two problems showed up in Mission 9.

1. **`pnpm check` is the pre-push hook, and it had grown too slow.** Measured on the owner's machine before this change: about 275 seconds (type check 172 s, tests 92 s, lint 6 s, tool gates 5 s). A hook people wait four and a half minutes for is a hook they skip with `--no-verify`. Most of the test time came from a handful of tests: the 1,000-tool similarity benchmark, the generated-tree type check, and tests that run the CLI scripts or a build of a fixture site.
2. **`pnpm test:e2e` did not work when a coding agent ran it.** Astro 7 detects an AI agent and silently starts `astro dev` and `astro preview` as a detached background process. Playwright's `webServer` cannot supervise that process, and on Windows it is killed together with its parent (withastro/astro#18019). The run then fails with a server that never answers.

There was also one flaky WebKit test (see Consequences).

## Decision

**Two test tiers.**

- `pnpm test` runs every test except those tagged `slow`. It is part of `pnpm check`, so the pre-push hook stays fast.
- `pnpm test:slow` runs only the tests tagged `slow`. CI's `quality` job runs it right after `pnpm check`, so nothing slow is skipped before a merge.
- A test is tagged with Vitest's own test tags: `it("name", { tags: ["slow"] }, () => { ... })`. The tag is declared in each project's `vitest.config.ts` (Vitest fails on an undeclared tag), and the two scripts use `--tags-filter`. No file has to be split, and a slow case stays next to the fast tests of the same subject.
- Rule of thumb: a test that takes more than about two seconds on its own, or that spawns a process or a build, is `slow`.

**Type check runs its four projects in parallel** (`pnpm -r --parallel run check`), with the same failure behaviour: any failure fails the script.

**Agent-safe E2E.** `playwright.config.ts` sets `ASTRO_PREVIEW_BACKGROUND=false` in `webServer.env`. It is Astro's own opt-out from agent detection (`astro/dist/cli/preview/index.js` skips detection when the variable is non-empty, and the Astro documentation names it). There is no `--foreground` flag. CI is not detected as an agent, so the setting changes nothing there. Verified by running `pnpm test:e2e` from a Claude Code session on Windows: 287 passed, 16 skipped, no server started by hand.

Rejected: upgrading to Astro 7.3.3 and passing `--ignore-lock`. It needs a dependency change for the same result.

## Consequences

- `pnpm check` is fast enough to stay a hook. Measured on the owner's machine, step by step:

  | Step | Before | After |
  |---|---|---|
  | type check | 172 s (four projects, one after another) | 46 s (in parallel) |
  | lint | 6 s | 5 s |
  | tests | 92 s | 55 s (and about 270 more tests: 412 before, about 680 now) |
  | tool gates | 5 s | 4 s |
  | **`pnpm check`** | **about 275 s** | **118 s** |

  The slow tier (`pnpm test:slow`, 28 tests) takes about 75 s and runs in CI. The 172 s type check was a first run; the four projects add up to about 55 s one after another when the caches are warm, so most of the gain in that row is running them in parallel.
- The slow tests still run on every pull request, in CI, before anything reaches `main`.
- A new slow test that is not tagged slows every push. Review catches it; the rule of thumb above is the check.
- **The flaky WebKit theme-toggle test.** "persists the choice after a reload" hung in 2 of 25 repeated WebKit runs, either inside `page.reload()` or in the first action after it. The cause is the cross-document view transition that `base.css` switches on under `prefers-reduced-motion: no-preference`: in Playwright's WebKit a reload during that transition sometimes never completes. The theme toggle has nothing to do with view transitions, so the theme-toggle tests run with reduced motion, and every step now waits for the state it needs (an attribute, the saved value, the meta colours), never for time.

## Revisit when

- Astro stops auto-backgrounding on Windows (withastro/astro#18019), which makes the environment variable unnecessary.
- The slow tier itself becomes slow enough to need sharding in CI.
