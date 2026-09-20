# 0031. Tool SDK package

Status: Accepted
Date: 2026-09-20

## Context

The tool contract ([tool-contract.md](../tool-contract.md)) has to be readable from more than one
place. The web app validates tools at build time; the Mission 9 generator writes tools and must
check what it wrote; a future API Worker will run tool logic without Astro anywhere near it.

Putting the contract in `apps/web` would make all of those depend on the website.

## Decision

`packages/tool-sdk` is a workspace package, `@networksinsights/tool-sdk`.

Pure TypeScript and Zod. No React, no Astro, no DOM, and no TypeScript compiler. It exports:

| Module | What it holds |
|---|---|
| `types.ts` | `ToolManifest`, `ToolRuntime`, `ToolStatus`, `ToolLimits` |
| `manifest.ts` | the Zod manifest schema and `defineTool()` |
| `files.ts` | `REQUIRED_FILES`, `OPTIONAL_FILES` and `ISLAND_SOURCE` |
| `content.ts` | the required H2 sections and the content checker |
| `purity.ts` | the allowed globals, the import allowlist and the banned globals |
| `validate.ts` | `validateTools()`, `ToolContractError` and the one message format |
| `privacy.ts` | the two privacy statements (ADR 0034) |

`defineTool()` types a manifest and returns it unchanged; it does not validate. Validation runs
once, in `validateTools()`, which is given the folder each manifest came from and can name it in
the error. A schema error thrown from inside a `tool.config.ts` could not.

`validateTools()` is pure: folders in, problems out. It takes the category ids and the reserved
paths as arguments rather than importing the web app's config, which keeps the dependency pointing
one way and makes the rules testable on plain objects.

### Dependency

`zod` 4.6.5, MIT, published 2026-09-13, added at an exact version (ADR 0006, ADR 0019). It is
already in the tree, because Astro 7.3.2 depends on `zod ^4.5.4`. It is used at build time only in
this mission: the registry runs during the build, so no Zod reaches the browser.

### Why the purity analyzer is not here

The analyzer that enforces `logic.ts` purity reads a TypeScript AST, so it needs the TypeScript
compiler. Depending on it would make the SDK heavy for every consumer. The rules — which globals
and which packages are allowed — live here, in one place; the analyzer that applies them lives in
`apps/web/src/lib/registry/purity.ts`, where TypeScript is already a devDependency.

## Consequences

- The contract has one home, and changing a rule is one edit with tests beside it.
- A tool package depends on the SDK and Zod, and on nothing else.
- Two packages must be built or type-checked for a contract change, and `pnpm typecheck` now runs
  the SDK's `tsc --noEmit` before `astro check`.

## Revisit when

A second app needs the contract at runtime rather than at build time, or the SDK grows a dependency
that a browser bundle would have to carry.
