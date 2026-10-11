# 0073. The 100 launch tools leave beta

Status: Accepted
Date: 2026-10-11

## Context

Every tool shipped with `status: "beta"`, the value `pnpm new:tool` writes. On 2026-10-11 all 100 tools on the live site still had it, so every tool page and every tool card showed a "Beta" badge. The SEO audit of the same day (Mission 19) flagged this: a badge on every tool says nothing about any one tool, and it tells a visitor the whole site is unfinished.

The manifest schema (`packages/tool-sdk/src/manifest.ts`) already has the value for a finished tool: `status` is `"beta"`, `"stable"` or `"deprecated"`, and `docs/tool-contract.md` says only beta and deprecated show a badge. Each of the 100 tools has passed every tool gate (`pnpm check:tools`), its unit tests and its E2E spec in all three browsers. None has a note in its manifest, its content or the docs that says it is not ready.

## Decision

- All 100 tools move from `"beta"` to `"stable"`. The change was made by a script that rewrote only the `status:` line of each `tool.config.ts` that said `"beta"`, and refused a file with no such line or with more than one. It changed 100 files and skipped none. No tool was kept in beta.
- The badge, the card and the structured data follow the status as before: nothing else was edited. `docs/tools-list.md` was regenerated with `pnpm tools:list`; it does not show the status, so it is unchanged.
- A tool's `updated` date is not moved. The date says when the tool's content or behaviour last changed, and neither changed.
- `pnpm new:tool` still writes `"beta"`. A new tool starts in beta and moves to stable in its own pull request once it has shipped and its gates pass.
- `"beta"` stays for a tool that is not ready: one whose output is known to be wrong in some cases, or that depends on a browser feature still behind a flag. Its content must then say what is not ready.

## Consequences

- Tool pages and cards no longer carry a badge. A future beta tool stands out because it is the exception.
- Moving a tool back to beta is a one-line change in its own pull request, with the reason in the tool's Limits section.
