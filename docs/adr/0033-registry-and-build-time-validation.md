# 0033. Registry and build-time validation

Status: Accepted
Date: 2026-09-20

Amended by [ADR 0046](0046-intent-loaded-search.md): the section "Zero JavaScript on listing pages" now allows exactly one deferred script, the search loader.

## Context

The site has to turn a folder of files into a page, a listing entry and a count, for 500+ tools,
without a page ever shipping JavaScript it does not need and without a broken tool reaching
visitors. ADR 0030 left one thing open: Astro allows only one dynamic route at a level, and both
category pages and tool pages live at the site root.

## Decision

### Discovery

`apps/web/src/lib/registry` finds tools with build-time globs over `tools/*/*/`:

| Glob | Loaded how | Why |
|---|---|---|
| `tool.config.ts` | eagerly, as modules | the manifests are the registry |
| the required files | lazily, keys only | a key is proof the file exists; nothing is read |
| `island.astro` | eagerly, `?raw` | compared to the contract source, byte for byte |
| `content/en.mdx` | eagerly, `?raw` | checked for its intro and its sections |

`?raw` matters: Astro's `.astro` transform and the MDX transform both exclude `?raw`, so these two
arrive as text. The registry holds metadata and text, never a component.

The manifests glob loads whole modules rather than `import: "default"`, so a `tool.config.ts`
without a default export gets the contract's own error instead of a bundler error.

### Validation

`validateTools()` in the SDK checks every rule and returns every problem it finds, each with the
folder it is in. The registry throws `ToolContractError` with all of them. Every page imports the
registry, so a broken tool fails the build rather than shipping a broken page. The rules are listed
in [tool-contract.md](../tool-contract.md).

`logic.ts` purity is enforced by `registry/purity.ts`, which reads a TypeScript AST: it collects
the names the file declares, treats every other name used as a value as a global, and checks it
against the SDK's lists. It reads syntax, not types, so a local that shadows a banned global is not
reported — the safe direction, because it never fails a build over something harmless.

### One route for both

`src/pages/[slug].astro` resolves a slug to a category or a tool, and `[category].astro` is gone.
This closes the open point in ADR 0030.

### Mounting a tool's island

Astro's compiler writes `client:component-path` only for a component it saw imported statically. A
route that resolves `ui.tsx` from a glob gets an island with no path and no export, and rendering
it throws `NoMatchingImport`. So a route can never mount a `ui.tsx` it looked up by tool id.

Astro's build graph does follow dynamic importers (`importers.concat(dynamicImporters)` in
`core/build/graph.js`), so a dynamically imported `.astro` module whose own import is static is
registered correctly. This is the path MDX islands already take.

Every tool therefore has an `island.astro` holding that one static import, fixed byte for byte, and
the route imports it dynamically. Measured on a probe tool: the page gets a correct
`component-url` and `component-export`, and the category pages built from the same route module get
no island, no script and no extra stylesheet.

The alternative, generating the wrappers into `apps/web` at build time, was rejected: the
generation step would have to run before `dev`, `build`, `typecheck` and `test`, or a fresh clone
fails, which is four new failure modes to avoid one three-line file that the Mission 9 generator
writes anyway.

### Zero JavaScript on listing pages

> Since Mission 11 (ADR 0046) these pages also carry one deferred script, the search loader, which fetches nothing until a visitor shows intent. Everything below still holds for framework JavaScript and islands.

The home page, `/tools/` and the category pages read the registry for names and counts. The two
modules that can load tool UI — `registry/islands.ts` and `registry/content.ts` — are imported by
`[slug].astro` alone, and only inside its tool branch. `zero-js.test.ts` checks that in the source;
`budgets.spec.ts` measures the built pages in Chromium, Firefox and WebKit.

### Dependency

`@astrojs/mdx` 8.0.1, MIT, published 2026-09-08, exact version (ADR 0019). 30 KB unpacked; its
dependencies are already in the tree. Its peer on `astro ^7.2.6` is satisfied by 7.3.2, and its
peer on `@astrojs/markdown-remark` is optional. It renders tool content only: the site's own pages
are `.astro`, so no page gains JavaScript from it.

### Testing without fake tools on the site

The production site ships zero tools. The fixtures live in
`apps/web/src/lib/registry/fixtures/<case>/<category>/<tool-id>/`, one case per rule, as real
folders with real files. The production glob is `tools/*/*/` — another folder and another depth —
so it cannot reach them, and a test asserts it.

## Consequences

- A tool is added by adding a folder. Nothing is registered by hand.
- A broken tool cannot ship: the build stops and says which folder and what.
- Every tool page carries one static, byte-identical `island.astro`.
- The registry parses every manifest on every build. At 500 tools that is still cheap, because it
  is metadata; if it stops being cheap, the eager raw globs are the first thing to make lazy.

## Revisit when

The build time of discovery becomes noticeable, tools need more than one language file, or Astro
supports hydrating a component resolved at runtime.
