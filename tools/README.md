# tools/

One folder per tool: `tools/<category-id>/<tool-id>/`. The contract is
[docs/tool-contract.md](../docs/tool-contract.md); the decisions behind it are ADR 0031–0037.

The first tool, `text/word-counter` (Mission 13), is the reference for a `client` runtime tool.

Do not write a tool folder by hand: `pnpm new:tool` creates it, and
[docs/adding-a-tool.md](../docs/adding-a-tool.md) says what to do next.

```
tools/<category-id>/<tool-id>/
  tool.config.ts    the manifest: export default defineTool({ ... })
  logic.ts          pure functions, no UI and no network
  ui.tsx            the React island
  island.astro      fixed glue, byte for byte (see ISLAND_SOURCE in the SDK)
  content/en.mdx    intro paragraph, then How to use, Examples, Limits, FAQ
  logic.test.ts     required
  worker.ts         optional, for the worker runtime (Mission 14)
```

The folder name is the tool id and the URL (`/<tool-id>/`), and the parent folder name is the
category id. The build fails, naming the folder and the problem, if any of that is wrong.

This package holds no shared code. `@networksinsights/tool-sdk` does. `tsconfig.json` here type-checks
every tool (`pnpm typecheck`), and maps `@ui` to the design system's React components.
