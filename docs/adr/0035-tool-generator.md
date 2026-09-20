# 0035. Tool generator

Status: Accepted
Date: 2026-09-21

## Context

The site starts at 500 or more tools, and most of them will be written by AI agents from a prompt
the owner pastes (docs/adding-a-tool.md). A hand-written tool folder is six files that must agree:
the manifest, the logic, the UI, the fixed `island.astro`, the page outline and a test. Every
mistake is found later, at build time, one at a time. The contract (ADR 0033) says what is wrong; it
cannot make the first version right.

## Decision

`pnpm new:tool` writes the complete folder, and the folder is right before anything is typed.

### Command

A TypeScript script at `scripts/new-tool.ts`, run with `tsx`. It works two ways:

- **Interactive**, in a terminal, for whatever flag is missing: it asks, one question at a time, and
  asks again after a wrong answer.
- **Non-interactive**, whenever there is no terminal, or `--json` is given: it never waits. A
  missing input is an error that lists the missing flags and shows a complete example command.

Flags: `--id --name --category --summary --runtime --tags`, plus `--dry-run` (check everything, write
nothing), `--json` (machine-readable result) and `--tools-root` (the tests use it).

### Validation, before anything is written

Every input is parsed by the SDK's `toolManifestSchema`, so the generator and the build cannot
disagree about a valid id, name, summary or tag. Beyond the schema it refuses an id that is a
category slug, a static page or a reserved path (ADR 0030), an id that is already a tool in any
category, an existing folder, and a name or summary that another tool has already (the same
`unique-name-and-summary` gate the build runs, ADR 0036). It reports every problem at once, each
naming its flag and giving an example.

### What it writes

`tool.config.ts` (status `beta`, `added` and `updated` set to today), `logic.ts` (a typed stub with
`Input`, `Result` and `run()`), `ui.tsx` (a working skeleton wired to `run()` with design-system
components from `@ui`), `island.astro` (`ISLAND_SOURCE` from the SDK, byte for byte),
`content/en.mdx` (the required headings in order) and `logic.test.ts` (a test that fails until
real ones are written), and `worker.ts` only for `runtime: worker`.

Every stub carries the marker `TODO(new-tool)`, exported by the SDK as `UNFINISHED_MARKER`. The
`unfinished-code` and `placeholders` gates (ADR 0036) fail the build while one remains, so a stub
cannot ship.

The schema is written in `tool.config.ts`, not `logic.ts`. A `z.object()` at the top of `logic.ts`
would put the Zod library in the island's JavaScript whenever `ui.tsx` imports `logic.ts`, because
a bundler cannot prove that building a schema has no side effect. The initial budget (ADR 0037)
is better spent on the tool.

### Failure leaves nothing behind

1. Write everything into `tools/.staging-<id>/`. A folder that starts with a dot is never a tool,
   so no glob matches it.
2. Move it to `tools/<category>/<id>/` in one rename, the last step.
3. On any error, or on Ctrl-C, remove the staging folder, and any category folder or `tools/`
   folder that this run created and nothing else has used.

It never overwrites: an existing folder is a refusal. The tests fail the Nth file write for every
N, fail the rename, and fail with a category folder that already exists, and check that nothing
new remains in every case.

### `@ui`, and type-checking tools

A tool's `ui.tsx` imports design-system components as `import { Button } from "@ui"`. The alias is
one line in `astro.config.mjs` (Vite) and one in `tools/tsconfig.json` (the type checker), so no
tool has a long relative path into `apps/web`.

`tools/tsconfig.json` is new: until now nothing type-checked tool code, because `astro check`
covers `apps/web` alone. `pnpm typecheck` now runs it, with the same strict options as the web app.

## Dependencies

One: **`tsx` 4.23.13**, MIT license, 397 KB unpacked, a root `devDependency`, never shipped. It
runs TypeScript with extensionless imports, which native Node type stripping cannot (the SDK and
the site config import each other without extensions, as does every tool). Its only dependency,
`esbuild ~0.28`, is already in the tree, and `allowBuilds` stays denied. 4.23.14 and 4.23.15 were
both published on 2026-09-20, inside `minimumReleaseAge`, so the newest version that policy allows
is pinned.

The scripts, and `tools/`, declare `react`, `@types/react` and `zod` at the versions already in the
lockfile. No other package was added.

`scripts/` is a workspace package (`@networksinsights/scripts`) so its imports resolve like any
other package's, and its tests are a Vitest project.

## Consequences

- A new tool starts valid, typed, type-checked, formatted by Biome and hydrating in the browser.
- The generator's output is tested against the real contract: generated tools load, validate, pass
  purity, and type-check strictly, including the worker stub.
- Adding an input to the manifest means changing `toolConfig()` in `scripts/lib/templates.ts`.
- A staging folder left by a hard crash (power loss, `kill -9`) is git-ignored (`tools/.staging-*/`)
  and removed by the next run for the same id.

## Revisit when

A tool needs more than one language file (ADR 0023), the manifest gains a required field the
generator cannot know, or Node runs extensionless TypeScript natively, which would make `tsx`
unnecessary.
