# Tool contract

Status: FINAL (Mission 8), extended by Mission 9 (generator, content gates, JavaScript budgets) and Mission 10 (Quick facts, answer-first gate, SEO)

Every tool is one folder that follows this contract. The platform builds everything else from it.
The build fails, naming the folder and the problem, if a folder breaks any rule on this page.

The contract lives in code as well as here: `packages/tool-sdk` (ADR 0031) holds the manifest
schema, the rules and the required file list, and `apps/web/src/lib/registry` enforces them at
build time (ADR 0033).

**Nobody writes a tool folder by hand.** `pnpm new:tool` writes it (ADR 0035), and
[adding-a-tool.md](adding-a-tool.md) is the step-by-step, with the prompt to give an AI agent.

## Folder anatomy

```
tools/<category-id>/<tool-id>/
  tool.config.ts    the manifest: export default defineTool({ ... })
  logic.ts          pure functions, no UI and no network
  ui.tsx            the React island
  island.astro      fixed glue that mounts ui.tsx (see below)
  content/en.mdx    the page content
  logic.test.ts     required
  worker.ts         the Web Worker of a `worker` tool (required for that runtime; see below)
```

The folder name is the tool id, and the parent folder name is the category id. Both must match the
manifest, because the folder name is the URL.

`ui.tsx` imports the design system's React components as `@ui`: `import { Button } from "@ui"`.
The alias is set in `apps/web/astro.config.mjs` and `tools/tsconfig.json`. Every `ui.tsx` is
type-checked by `pnpm typecheck`.

Tools live at the repo root, not inside `apps/web`, so a future API Worker can import tool logic
without moving 500 folders (ADR 0032).

## Manifest

```ts
import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "word-counter",
  name: "Word counter",
  category: "text",
  summary: "Count the words, characters and lines in any text, as you type.",
  tags: ["words", "characters"],
  runtime: "client",
  status: "beta",
  input: z.object({ text: z.string() }),
  related: ["case-converter"],
  // Optional file formats, shown in Quick facts (ADR 0044). Leave both out for a tool that works
  // on text or numbers:
  // accepts: ["PDF", "PNG"],
  // produces: ["PDF"],
  added: "2026-09-20",
  updated: "2026-09-20",
  // Only for a genuinely heavy tool (ADR 0037):
  // budget: { maxOnDemandJsKb: 3000, reason: "Loads a WebAssembly PDF renderer after a file is chosen." },
  // Only with an accepted ADR (ADR 0047), for a tool that needs more than the site-wide headers:
  // security: { adr: "0051", crossOriginIsolated: true },
});
```

| Field | Rule |
|---|---|
| `id` | Kebab-case, unique, the same as the folder name. It is the URL: `/<id>/` (ADR 0014). |
| `name` | 1–60 characters. The H1 and part of the page title. |
| `category` | A category id from `apps/web/src/config/categories.ts`, the same as the parent folder. |
| `summary` | 20–159 characters, unique across all tools. It is the meta description and the line under the H1. Digits are allowed: Base64, SHA-256, MP4, UTF-8 and H.264 are real names. |
| `tags` | One to eight unique kebab-case tags. |
| `runtime` | `"client"`, `"worker"` or `"server"` (ADR 0012). It decides the privacy statement. |
| `status` | `"beta"`, `"stable"` or `"deprecated"`. Beta and deprecated show a badge. |
| `input` | A Zod schema (ADR 0006). |
| `related` | Up to six ids of other tools that exist. Never this tool's own id. |
| `accepts`, `produces` | Optional. One to twelve file formats, named as a reader names them (`PDF`, `JPG`, `H.264`, `Plain text`), no repeats. They appear in the page's Quick facts only when present (ADR 0044). `pnpm new:tool` takes `--accepts` and `--produces`. |
| `limits` | Optional `{ maxInputBytes, maxFiles, maxRunsPerDay }` for a future Pro tier. Absent means unlimited, which is what every tool ships with today. |
| `budget` | Optional. Raises the JavaScript budget of a heavy tool: `maxInitialJsKb` (above 40, up to 250) and/or `maxOnDemandJsKb` (above 1,024, up to 8,192), and a `reason` of at least 20 characters. Never displayed on the page (ADR 0037). |
| `security` | Optional, and only with an accepted ADR: `{ adr, crossOriginIsolated?, sources? }`. Gives this page cross-origin isolation (COEP `require-corp`) and/or extra https origins for `connect-src`, `img-src`, `media-src`, `font-src` or `worker-src`. Never scripts or styles. See "Security overrides" below (ADR 0047). |
| `added`, `updated` | Real ISO dates, `YYYY-MM-DD`. `updated` is never earlier than `added`. |

`defineTool()` types the manifest and returns it unchanged. It does not validate: validation runs
once, centrally, where the folder is known and the error can name it.

## logic.ts: what pure means

The same logic runs unchanged in the browser, a Web Worker and a Cloudflare Worker, so it may use
only what all three have. The lists live in `packages/tool-sdk/src/purity.ts`; the analyzer that
enforces them is `apps/web/src/lib/registry/purity.ts`. `purity.test.ts` fails the tests and
`pnpm check:tools` reports it, naming the file and the fix.

Allowed:

- ECMAScript built-ins, and the web APIs all three runtimes share: `crypto.getRandomValues`,
  `crypto.subtle`, `TextEncoder`, `TextDecoder`, `URL`, `URLSearchParams`, `Intl`,
  `structuredClone`, `atob`, `btoa`, `ArrayBuffer` and the typed arrays, streams, `Blob`.
- Imports of `zod`, `@networksinsights/tool-sdk`, and relative files inside the tool's own folder.

Refused:

- DOM globals (`window`, `document`, `navigator`, `localStorage`), because the DOM belongs in
  `ui.tsx`.
- Node-only globals (`process`, `Buffer`, `require`), because the browser does not have them.
- `fetch` and every other way to the network: the runtime decides what leaves the device.
- React, Astro, and any import ending in `.tsx`, `.astro`, `.css` or `.mdx`.
- Statements at the top level. A module may declare things; importing it must do nothing.

**Adding a library** — a PDF engine, an image codec — is one line in `ALLOWED_IMPORTS` plus an ADR
stating its license, its size and why it is needed. The allowlist starts at Zod and the SDK so that
every third-party dependency inside tool logic is a recorded decision.

## island.astro

Every tool's `island.astro` is this file, byte for byte:

```astro
---
import Ui from "./ui.tsx";
---

<Ui client:load />
```

It exists because Astro writes the hydration path only for a component it saw imported statically,
so a route cannot mount a `ui.tsx` it looked up by tool id. This file holds that static import, and
the route imports this file dynamically (ADR 0033). It is glue, not a place for tool code, which is
why the validator compares it exactly and `pnpm new:tool` writes it.

`client:load` is the hydration choice for every tool: the workspace is the reason a visitor opened
the page, and it is above the fold, so a later directive would only delay the first interaction.

## content/en.mdx

An intro paragraph, then exactly these H2 sections, in this order:

```mdx
Word counter counts the words in any text as you type. It is for anyone with a limit to meet.

## How to use

## Examples

## Limits

## FAQ
```

The first sentence of the intro answers first: it says what the tool does, in at most 30 words, and
should name the tool (ADR 0044). No H1: the page template renders the one H1, the tool name. More
depth goes under H3s inside a section. The FAQ is `###` questions ending in `?`, each followed by its answer. The content quality
gates (ADR 0036) add word minimums, no placeholders and no near-duplicates on top of these rules;
see "Content quality gates" below.

## The worker runtime

A `worker` tool does its heavy work in a Web Worker, so the page never freezes (ADR 0051). Both
sides speak one typed protocol from `@networksinsights/tool-sdk/worker`: the page sends `run` and
`cancel`, the worker answers `progress`, `result`, `error` or `cancelled`.

`worker.ts` calls `defineWorker` once. The handler gets the input, `progress()` and an abort
`signal`; throw a `ToolError` for a problem the visitor can fix, and its message is shown to them.

```ts
import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import type { Input, Output } from "./logic";

defineWorker<Input, Output>(async (input, { progress, signal }) => {
  // ...one step...
  signal.throwIfAborted();
  progress({ done: 1, total: 2, stage: "Encoding" });
  // ...the next step...
});
```

`ui.tsx` sends it jobs with `createWorkerClient` from `@ui`. The worker starts on the first run, so
its code is on-demand JavaScript:

```tsx
import { createWorkerClient, WorkerJobError } from "@ui";

const client = createWorkerClient<Input, Output>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

const output = await client.run(input, { onProgress, signal: controller.signal });
```

- Aborting the signal rejects the job at once with an `AbortError`. A worker that does not stop
  within 400 ms is terminated, and the next run starts a new one.
- A failed job rejects with a `WorkerJobError`. Show its `message` only when `expected` is true.
- Inputs and outputs are structured-cloned: send the visitor's `File` as it is.
- `worker.ts` may use the web APIs a worker has (`OffscreenCanvas`, `createImageBitmap`); keep the
  rules that decide what to do in the pure `logic.ts`, where they are tested.

## Security

Every tool page gets the site's Content-Security-Policy and security headers (ADR 0047, ADR 0048):
same-origin scripts only (no inline script, no `eval`), same-origin fetches only, Web Workers and
WebAssembly allowed, `blob:` and `data:` images and media allowed. A tool never writes a header or a
`<meta>` policy itself.

### Downloads

A tool gives the visitor a file only with `saveFile` from `@ui` (ADR 0050):

```tsx
import { Button, saveFile } from "@ui";

<Button onClick={() => saveFile(result, `${file.name}.png`, { extension: "png" })}>Download</Button>
```

It makes the name safe (`safeFilename`: no paths, no control or bidirectional characters, no Windows
reserved names, at most 255 bytes), sets the type from the extension (`mimeTypeFor`, or
`application/octet-stream`), always downloads instead of opening a tab, and revokes the object URL
once the download has started. `safeFilename` and `mimeTypeFor` are pure, so `logic.ts` may import
them from `@networksinsights/tool-sdk` to name its result. Never make an `<a href="blob:…">` or call
`window.open` on a result yourself.

### Rendering user text

Words from the visitor or from a file reach the page as text, never as markup or code (ADR 0050):

- In React, `{value}`. Outside React, `setText(node, value)` from `@ui`.
- A URL the visitor typed becomes a link only through `safeUrl(value)` from `@ui`, which returns an
  absolute http, https or mailto URL, or `undefined`.
- Never: `innerHTML`, `outerHTML`, `srcdoc`, `insertAdjacentHTML`, `dangerouslySetInnerHTML`,
  `document.write`, `DOMParser`, `createContextualFragment`, `setHTMLUnsafe`, `eval`,
  `new Function`, a string passed to `setTimeout` or `setInterval`, or a `javascript:` URL. The
  `safe-rendering` gate in `pnpm check:tools` fails on each, naming the line.

### Security overrides

Almost no tool needs one. A tool that genuinely needs cross-origin isolation (multi-threaded
WebAssembly, `SharedArrayBuffer`) or one more https origin sets `security` in its manifest, naming
the ADR that approved it. `pnpm check:tools` fails unless that ADR is Accepted. The steps are in
[runbooks/security.md](runbooks/security.md), "Add a CSP exception for a tool".

### Server runtime

A `runtime: "server"` tool runs behind an endpoint on our own origin that validates the input with
the manifest's `input` schema before any work, refuses oversized bodies, rate-limits per IP, stops at
a hard daily spending cap, logs nothing the visitor sent, and stores no user data. The full contract
is ADR 0050, section 3. Mission 15 builds the shared middleware that enforces it, so a tool never
writes its own.

## The page the contract builds

| Part | Where it comes from |
|---|---|
| URL | `/<id>/` |
| Title | `<name> — Free online tool \| NetworksInsights` |
| Meta description | `summary` |
| Breadcrumbs | Home → category → tool |
| H1 and the line under it | `name` and `summary` |
| Workspace card | `island.astro`, which mounts `ui.tsx` |
| Status badge | `status`, for beta and deprecated only |
| Privacy badge | `runtime`, never written by hand (ADR 0034) |
| Quick facts | Price, sign-up, where it runs, files uploaded, limits, accepts, produces and the update date, all from the manifest (ADR 0044) |
| Canonical, share tags, share image, structured data | The route, the manifest and the content, through `apps/web/src/lib/seo/` (ADR 0038 to 0041) |
| Sections | `content/en.mdx` |
| Related links | `related` |
| Category listing and counts | `category` |

The privacy statement is derived, not authored: `client` and `worker` say "Runs in your browser —
files never leave your device"; `server` says "Runs on our server — your input is sent to us to be
processed". A tool cannot claim the wrong one, because nobody types the sentence.

## Build-time gates

The build fails if any of these fail. Each message names the folder and the exact problem:

- The manifest parses against the schema.
- Ids are unique, kebab-case, match the folder, and take no reserved path (a category slug or a
  static page, ADR 0030).
- The category exists and matches the parent folder.
- Every `related` id exists and is not the tool itself.
- Summaries are unique.
- `updated` is not earlier than `added`.
- Every required file exists.
- `island.astro` is the contract source, byte for byte.
- `content/en.mdx` has an intro and the four H2 sections, in order, with no H1.
- Every `logic.ts` is pure.
- A `budget` field, when present, raises something, stays under the ceiling and gives a reason.
- A `security` field, when present, widens only fetch directives, only with https origins.

### Content quality gates

Run by the production build, `pnpm check:tools` and CI (ADR 0036). Each problem names the tool,
the file, what is wrong and how to fix it.

| Gate | Rule |
|---|---|
| `answer-first` | The first sentence of the intro has at most 30 words (ADR 0044). |
| `answer-first-name` | **A warning, never a failure.** The first sentence of the intro contains the tool's name. |
| `min-words` | Prose words (code blocks excluded): intro 40, How to use 50, Examples 40, Limits 30, FAQ 60. |
| `placeholders` | No `TODO`, `TBD`, `FIXME`, "lorem ipsum", "coming soon", "to be written", `[insert …]`, and no empty section. Also in the name, summary and budget reason. |
| `unfinished-code` | No `TODO(new-tool)` marker left in `logic.ts`, `ui.tsx`, `logic.test.ts` or `worker.ts`. |
| `faq-structure` | At least two `###` question-and-answer pairs; each question ends in `?`, each answer has at least five words. |
| `faq-repeats` | No FAQ sentence of five words or more that is also in the intro or another section. |
| `unique-name-and-summary` | No two names the same (case, punctuation and word order ignored), no two summaries at 0.60 similarity or more. Titles are built from names. |
| `near-duplicate` | No two pages at a similarity of 0.30 or more (Jaccard score of word 4-shingles). |

**In `astro dev` the quality gates only warn**, so a tool that is being written keeps rendering. The
contract and purity are hard failures everywhere, because they break rendering.

### JavaScript budget

After the build, `pnpm check:budgets` measures each tool page's own JavaScript in the build output,
in two numbers (ADR 0037): **initial**, loaded with the page (40 KB gzip by default), and **on
demand**, fetched after a user action (1,024 KB by default). Moving heavy code behind a dynamic
`import()` moves it from the first to the second. CI runs it after `pnpm build`.

A **warning** gate prints its advice with `!` in `pnpm check:tools` and in the build log, and never
fails either.

Still to come: complete translations for enabled languages (ADR 0023).

## Checking a tool

| Command | What it does |
|---|---|
| `pnpm new:tool` | Creates a tool folder (ADR 0035). |
| `pnpm check:tools` | Runs the contract, purity, safe rendering, security overrides and the content quality gates on every tool and prints a summary. |
| `pnpm check:tools --tool <id>` | The same for one tool, fast with hundreds of tools. `--json` prints JSON. |
| `pnpm check:budgets` | The JavaScript budget of every tool page, after `pnpm build`. |
| `pnpm check` | Type-checks tools too, lints, tests, and runs `check:tools`. |

## Generated from the manifest

Page and URL, category listing, breadcrumbs, related links, the counts on the home page, `/tools/`
and the category pages, the canonical link, the Open Graph and Twitter/X tags, the share image, the
structured data (`WebApplication`, `FAQPage`, `BreadcrumbList`), the sitemap entry, the `llms.txt`
line and the Quick facts. The search index and the new-tools feed follow in Mission 11.

## URL rule

A tool lives at `/<tool-id>/` at the site root, independent of its category (ADR 0014). Moving a
tool between categories never changes its URL. Renames go through a redirects registry, so no URL
ever returns 404.
