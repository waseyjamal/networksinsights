# 0037. Per-tool JavaScript budgets

Status: Accepted
Date: 2026-09-21

## Context

The site's speed is a promise (LCP, INP, CLS targets in docs/architecture.md), and a tool page is
the one place a page ships framework JavaScript. Each of 500 or more tools can add code, and a
page that gets slower one tool at a time is never one pull request's fault. `docs/tool-contract.md`
planned a JavaScript budget for Mission 17. Mission 9 pulls the per-tool part forward, because the
generator makes tools cheap to add and the budget must exist before the first one (Mission 13).

A single number would punish the tools that behave best. A PDF or media tool needs an engine, and
the right way to ship one is to fetch it after the visitor chooses a file, not to load it with the
page. So the budget has two numbers, and moving code from the first to the second is how a tool
stays within budget.

## Decision

### Two numbers, measured separately, in KB of gzip

| | Default | Ceiling | What it measures |
|---|---|---|---|
| **Initial** | 40 KB | 250 KB | The tool's own code loaded on page load: the island's static import closure, without the shared renderer (React, ReactDOM, Astro's client runtime). |
| **On demand** | 1,024 KB | 8,192 KB | Code fetched only after the visitor does something: chunks reached only through a dynamic `import()`, and `.wasm` files and worker scripts loaded by URL. |

They fail separately, each with its own message. Design-system components a tool imports count as
the tool's own code, because the visitor downloads them.

**Why 40 KB initial.** The shared renderer is about 67 KB of gzip and is the same on every tool
page (measured: `client.js` 65.6 KB, `react.js` 3.0 KB). A tool page's JavaScript is therefore that
plus the tool's own. The generated skeleton, with its design-system components, is **3.7 KB**.
40 KB is about ten times that: room for a real interface and real logic (a parser, a formatter, a
converter), and it puts a tool page's JavaScript near 107 KB of gzip, about half a second on the
1.6 Mbit/s connection Lighthouse calls slow 4G. The island is server-rendered HTML (every page is
complete without JavaScript), so this JavaScript does not delay first paint; it delays
interactivity, which is what the INP target measures.

**Why 1,024 KB on demand.** This is code that costs the visitor nothing until they act, and then
costs one transfer they asked for, with the tool free to show progress. A WebAssembly PDF renderer
or an image-codec set is hundreds of KB to a few MB compressed; 1 MB fits the ordinary cases with
no paperwork. The ceiling of 8 MB, reachable with a reason, is meant to fit a heavy WebAssembly
engine. It deliberately excludes a full media transcoder, which is tens of MB: that belongs in a
downloaded asset with its own loading experience and an ADR of its own, not in a page's JavaScript.
These sizes are set before the first such tool is chosen (Missions 13 to 15). When one is, its
real size is recorded here and the numbers are revisited.

### How it is measured

`pnpm check:budgets` reads the real build output in `apps/web/dist`, so it needs `pnpm build`
first. For each tool it opens `dist/<id>/index.html`, finds the `<astro-island>` and its two
scripts (the component's and the renderer's), and follows the import graph of the built chunks:

- **shared** is the renderer's static closure. It is charged to nobody.
- **initial** is the component's static closure minus shared.
- **on demand** is what the component reaches through `import()`, and `.wasm` files and worker
  scripts named with `new URL(..., import.meta.url)`, minus what is already initial or shared.
  A `.wasm` file always counts as on demand: it is fetched by an explicit call.

Sizes are gzip at level 9. Brotli, which Cloudflare serves, is smaller and is printed as well;
the budget uses gzip because it is the conservative one. The graph is read with regular
expressions over minified chunks, including the backtick-quoted `import(\`./x.js\`)` that the
bundler writes; the tests use files shaped like real output, and the reading was also checked on
real builds of a sample tool (below).

CSS, fonts and the rest of the page are not part of the budget. `--report` prints them:

| Sample: `/word-counter/`, a generated tool finished with real content | raw | gzip | brotli |
|---|---|---|---|
| HTML (with inline scripts and styles) | 18.5 KB | 5.6 KB | 4.7 KB |
| CSS (1 file) | 59.0 KB | 11.4 KB | 9.8 KB |
| Fonts (2 files, already compressed) | 51.3 KB | 51.4 KB | 51.3 KB |
| Shared runtime (React, Astro client) | 215.6 KB | 67.1 KB | 58.1 KB |
| Tool JavaScript, initial | 8.8 KB | 3.7 KB | 3.2 KB |
| Tool JavaScript, on demand | 0 | 0 | 0 |
| **Total** | **353.3 KB** | **139.0 KB** | **127.1 KB** |

On the same tool, moving a 74 KB module (gzip) behind `await import("./engine")` gave initial 4.3
KB and on demand 74.1 KB, which passes. Importing it statically gave initial 77.9 KB, which fails,
naming the file and suggesting the dynamic import. The sample tool was thrown away after the
measurement: the site ships no tools until Mission 13.

### Enforcement

`pnpm check:budgets` runs in CI, in the `quality` job, right after `pnpm build`. It exits 1 when a
page is over budget, printing the tool, the file, the size, the limit and the fix. With no tools,
as today, it passes and says there is nothing to measure; it starts measuring at Mission 13 with
no change. Because it reads the build output, it needs `pnpm build` first and is not part of
`pnpm check`.

### Raising a budget: the manifest

A tool that is genuinely heavy raises its budget in `tool.config.ts`, and must say why.

```ts
budget: {
  maxOnDemandJsKb: 3000, // and/or maxInitialJsKb
  reason: "Loads a WebAssembly PDF renderer after the visitor chooses a file.",
},
```

- The manifest schema (`toolBudgetSchema`, in the SDK) requires a `reason` of at least 20
  characters, requires the field to raise something, requires each number to be above the default
  and at or under the ceiling, and refuses other keys.
- The `placeholders` gate refuses a reason that says TODO.
- The **tool page never displays it**: `ToolPage.astro` reads name, summary, status and runtime
  from the manifest, and a test renders a tool with a budget and asserts the reason is absent.
- `pnpm check:tools` lists every tool with a raised budget and its reason, so the owner can review
  them in one place.
- A number above a ceiling is refused by the schema. Past a ceiling needs an ADR that changes
  the ceiling.

## Consequences

- A tool that keeps its engine behind an `import()` pays nothing for it in the initial budget,
  and the message that fails a tool that does not says exactly that.
- The budget is a static reading of the output, not a browser measurement. It cannot see code that
  is fetched by a URL it builds at run time. That is a rule for authors (import, or name the URL
  with `new URL(..., import.meta.url)`) and a review point, not something the tool can check.
- Design-system growth raises every tool's initial size a little; the design system's own CSS
  budget (e2e/budgets.spec.ts) is separate.
- The `quality` CI job gains the `check:budgets` step, and its timeout goes from 10 to 15 minutes,
  because `pnpm check` now includes the scripts' tests, which generate tools and run the compiler.
- This replaces the JavaScript-size item that docs/tool-contract.md had planned for Mission 17.
  Mission 17 keeps the offline work and the site-wide budgets.

## Revisit when

The first WebAssembly tool is chosen (record its size and revisit the on-demand numbers), the
shared renderer changes (its 67 KB is the reason for the 40), a tool needs its own worker script
counted differently, or the check needs a real browser to see what a bundler cannot tell it.
