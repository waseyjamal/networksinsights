# 0070. Test limits, tolerances and timeouts are never loosened to make a test pass

Status: Accepted
Date: 2026-10-09

## Context

Tool tests compare pixels, durations, sizes and timings against limits. When a run fails, the
quickest way to green is to raise a tolerance, a limit or a timeout. That hides real bugs and makes
a check say less than it claims. Batches 1 to 10 gave two examples:

- ADR 0066, Background Remover: its limits were changed after the first run failed, and the ADR
  states the measured reason with the old and new limits side by side. The Upscaler's tolerances
  were written before any browser run and never raised.
- The Audio Joiner join check (`apps/web/e2e/audio-joiner.spec.ts`): the joined duration must be
  2.5 seconds to 4 decimal places.

Some failed runs are caused by a mistake in the spec itself: a wrong fixture, a wrong library used
to read the output, or a loop that makes thousands of `expect` calls.

## Decision

1. A test limit, tolerance or timeout is never changed to make a test pass.
2. A change needs a measured reason, and the old and new limits side by side, in an ADR section or
   in the pull request description.
3. A spec fix that makes a check weaker counts as loosening and follows rule 2.
4. A spec mistake (wrong fixture, wrong library, thousands of `expect` calls) may be fixed when the
   check is not weaker. The mission or pull request report says what changed and why.

## Consequences

A red test is fixed in the code, or by fixing a spec mistake that keeps the check as strong. Every
looser limit has a written, measured reason a reviewer can check.
