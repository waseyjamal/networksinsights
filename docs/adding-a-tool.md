# Adding a tool

The complete route from an idea to a merged tool. Everything a tool must satisfy is in
[tool-contract.md](tool-contract.md); this page is the order to do it in, and the commands that
check each step. The decisions behind the tooling are ADR 0035 (generator), 0036 (content gates)
and 0037 (budgets).

The rule that makes this fast: **nobody writes a tool folder by hand.** `pnpm new:tool` writes it,
so the files are right before the first line of the tool is typed. The gates then refuse anything
that is still a stub, so an unfinished tool cannot ship by accident.

## 1. Decide the inputs

| Input | Rule | Example |
|---|---|---|
| `id` | Kebab-case. The folder name and the URL: `/<id>/`. Never a category slug, a static page or an existing tool. | `word-counter` |
| `name` | Up to 60 characters. The page title and the H1. Unique. | `Word counter` |
| `category` | A category id from `apps/web/src/config/categories.ts`: `pdf`, `image`, `video-audio`, `text`, `calculators`, `converters`, `generators`, `developer`, `web-seo`, `color-design`, `date-time`. | `text` |
| `summary` | 20 to 159 characters. The meta description and the line under the H1. Unique and not close to another. | `Count the words, characters and lines in any text, as you type.` |
| `runtime` | `client` (browser), `worker` (Web Worker), `server`. It decides the privacy statement, which nobody writes by hand (ADR 0034). | `client` |
| `tags` | One to eight kebab-case tags. | `words, characters` |
| `accepts`, `produces` | Optional. The file formats it takes in and gives back, as a reader names them. They appear in the page's Quick facts. Leave them out for a tool that works on text or numbers. | `PDF, PNG` and `PDF` |

## 2. Create the folder

```bash
pnpm new:tool --id word-counter --name "Word counter" --category text \
  --summary "Count the words, characters and lines in any text, as you type." \
  --runtime client --tags words,characters
# for a tool that works on files, add:  --accepts PDF,PNG --produces PDF
```

In a terminal, leave a flag out and it asks. Without a terminal (an AI agent, CI) it never waits:
it says which flags are missing and shows an example. `--dry-run` checks everything and writes
nothing; `--json` prints the result for a script.

It refuses, before writing anything, an invalid input, an id that is already a tool, a category
slug, a static page or a reserved path, and a name or summary that another tool already has. It
never overwrites a folder. If anything fails while writing, it removes what it made.

It writes `tools/<category>/<id>/`:

| File | What it is when it is created |
|---|---|
| `tool.config.ts` | The manifest, filled in. `status: "beta"`, `added` and `updated` are today. |
| `logic.ts` | A typed stub: `Input`, `Result` and `run()`, which echoes its input. Marked `TODO(new-tool)`. |
| `ui.tsx` | A working skeleton: a text box, a button and a result, wired to `run()` with design-system components. |
| `island.astro` | The fixed contract source. Never edit it. |
| `content/en.mdx` | The required headings in order, with `TODO(new-tool)` placeholders. |
| `logic.test.ts` | One test that fails until you write real ones. |
| `worker.ts` | Only for `runtime: worker`: calls `defineWorker`, and `ui.tsx` sends it jobs with `createWorkerClient` (ADR 0051). Marked `TODO(new-tool)`. |

The commands to check the tool are printed at the end. Work on a branch named
`tool/<tool-id>` (AGENTS.md), for example `tool/word-counter`, never on `main`. A mission that is not
one tool keeps `mission/NN-short-name`.

## 3. Write the logic

`logic.ts` is pure: no DOM, no Node globals, no network, no top-level statements, and imports only
from `zod`, `@networksinsights/tool-sdk` or its own folder ("logic.ts: what pure means" in
[tool-contract.md](tool-contract.md)). Keep `Input` in step with `input` in `tool.config.ts`: the
schema lives in the config, so the Zod library stays out of the island's JavaScript.

Then replace the failing test in `logic.test.ts` with real ones: a typical input, an empty input,
the edge cases, and every limit the page will describe.

## 4. Build the workspace

Edit `ui.tsx`. Import components from `@ui` (`import { Button, Textarea } from "@ui"`), which is the
design system's React entry ([design-system.md](design-system.md)). Use those components and the
design tokens; a component that does not exist goes into the design system first, in its own
change. The page already draws the workspace card and the privacy statement, so the island renders
only the fields, the buttons and the result.

Give files back with `saveFile` from `@ui`, show visitor text as `{value}`, and link a visitor's URL
only through `safeUrl`. `innerHTML`, `dangerouslySetInnerHTML`, `eval` and the other HTML and code
sinks fail the `safe-rendering` gate ([tool-contract.md](tool-contract.md), "Security").

Keep the island small. The budget is 40 KB of gzip for the tool's own code that loads with the
page. **Heavy code loaded after a user action does not count against that number**: put a PDF
engine, a codec or a WebAssembly module behind a dynamic import.

```tsx
const engine = await import("./engine"); // in the click handler, not at the top of the file
```

See "The JavaScript budget" below.

## 5. Write the content

`content/en.mdx` is an intro paragraph, then exactly these H2 sections in this order, and no H1:

| Part | Minimum (words of prose) | What it must do |
|---|---|---|
| Intro | 40 | Answer first: the first sentence says what the tool does, in at most 30 words, and names the tool. Then who it is for and what makes it worth opening. |
| How to use | 50 | Walk through the steps, in order, with the choices a visitor meets. |
| Examples | 40 | Show a real input and the exact output, and say what to notice. |
| Limits | 30 | Say honestly what it cannot do: size, formats, accuracy, browsers. |
| FAQ | 60, and 2 pairs | Each question is an `### H3` ending in `?`, followed by an answer of at least 5 words. |

Words are counted in prose only. Code blocks do not count; headings, list items, link text and
inline code do. The FAQ must add information: a sentence of five words or more that also appears
in the intro or another section fails.

Everything on the page must be true of this tool alone. AGENTS.md is firm: never invent content,
counts, ratings or claims. Do not write a page by changing the name in another tool's page: the
build compares every page with every other, and fails a pair that reaches a similarity of 0.30 (see
"What the gates check").

Anything that must stay in a page but looks like a placeholder, such as the phrase "Lorem ipsum"
on a lorem-ipsum generator's page, goes in a code block or an example block. Placeholder text in
prose fails.

## AEO rules

Assistants that answer questions quote short, self-contained statements, so a page is written to be
quoted (ADR 0044). The rules are the same as the ones above, and the two gates check the first.

1. **Answer first.** The first sentence of the intro says what the tool does, in at most 30 words,
   and names the tool: *"Word counter counts the words, characters and lines in any text, as you
   type."* A quoted first sentence must still make sense with the page gone. Who it is for, and why
   it is worth opening, come after it. `answer-first` fails a longer sentence; `answer-first-name`
   warns when the name is missing.
2. **Write FAQs as real questions.** Phrase each `###` heading the way a person types it into a
   search box or asks an assistant: *"Is my text uploaded?"*, *"Does it count spaces?"*, not *"Data
   handling"*. Answer in the first sentence, then add detail.
3. **Facts only from data.** The page already states the price, sign-up, where the tool runs,
   whether files are uploaded, the limits and the update date, from the manifest (Quick facts). Do
   not repeat them by hand in prose where they could go stale or disagree, and never write a number,
   a limit or a format that the manifest does not hold. Add `accepts` and `produces` to the
   manifest instead.
4. **No invented claims.** No "fastest", "most accurate", "trusted by", counts, ratings or
   testimonials. If you cannot show it, do not say it (AGENTS.md).

## 6. Check as you go

```bash
pnpm dev                          # http://localhost:4321/<id>/
pnpm check:tools --tool <id>      # every tool gate, for this tool only
pnpm test tools/<category>/<id>   # its tests
```

In `pnpm dev` a work-in-progress tool keeps rendering: content quality problems print as a
warning in the terminal (`pnpm --filter web exec astro dev logs` when the server runs in the
background) and the page stays up. Contract violations still stop the page, because they break
rendering. In `pnpm build`, `pnpm check:tools` and CI, quality problems are hard failures.

`pnpm check:tools` prints one line per gate, then every problem with the file and the fix:

```text
Tool checks: tools/text/word-counter (of 12 tools)

  ✓ contract                 Tool contract
  ✓ purity                   logic.ts is pure
  ✗ min-words                Enough real words in every section  1 problem
  ...

Quality gate "min-words": tools/text/word-counter — the "Limits" section has 18 words of prose; the minimum is 30
    File:    tools/text/word-counter/content/en.mdx
    Fix:     Say honestly what the tool cannot do: size, formats, accuracy, browser support. Add about 12 more words of real prose; code blocks are not counted.
    Example: It does not <thing>. Very large <inputs> may <effect>.
```

`--json` prints the same as JSON.

## 7. The whole check, as CI runs it

```bash
pnpm check           # typecheck (tools included), lint, the fast tests, tool gates: about two minutes
pnpm test:slow       # the slow tests, which CI runs and the pre-push hook does not
pnpm build
pnpm check:budgets   # the JavaScript budget of every tool page, on the build just made
pnpm check:seo       # canonical, share tags and image, structured data, sitemaps, on the build just made
```

`pnpm check:budgets --report` also prints the total page weight of each tool page.

## 8. The JavaScript budget

Two numbers are measured separately on the built page, in KB of gzip, for the tool's own code (the
shared React and Astro runtime is not counted):

| | Default | Ceiling with a reason | What it is |
|---|---|---|---|
| Initial | 40 KB | 250 KB | The island's code that loads with the page. |
| On demand | 1,024 KB | 8,192 KB | Code fetched after a user action: dynamic imports, `.wasm` files, workers. |

A genuinely heavy tool may raise either number in `tool.config.ts`, with a reason. The page never
shows it.

```ts
export default defineTool({
  // ...
  budget: {
    maxOnDemandJsKb: 3000,
    reason: "Loads a WebAssembly PDF renderer after the visitor chooses a file.",
  },
});
```

The reason must be at least 20 characters, and the number must be above the default and under the
ceiling. Past a ceiling, write an ADR. `pnpm check:tools` lists every tool that has raised its
budget, with its reason.

## 9. Open the pull request

- The tool folder, and nothing else that is not needed for it.
- `status` is `beta` until you are satisfied with the tool; then `stable`. Set `updated` to the date
  of the last change.
- `related` lists up to six existing tools worth linking.
- Every `TODO(new-tool)` marker is gone.
- Title: the tool's name. Do not merge: the owner merges.

## What the gates check

Run by `pnpm build`, `pnpm check:tools` and CI. A problem names the tool, the file, what is wrong
and how to fix it.

| Gate | Fails when |
|---|---|
| contract | The manifest, the required files, `island.astro` or the page outline break [tool-contract.md](tool-contract.md). Also a hard failure in dev. |
| purity | `logic.ts` touches the DOM, Node, the network, a banned import, or has top-level statements. |
| min-words | A section has fewer prose words than the minimum above. |
| answer-first | The first sentence of the intro has more than 30 words. |
| answer-first-name (warning) | The first sentence of the intro does not contain the tool's name. Printed, never a failure. |
| placeholders | A section is empty, or holds `TODO`, `TBD`, `FIXME`, "lorem ipsum", "coming soon", "to be written" or `[insert …]`. Also checked in the name, summary and budget reason. |
| unfinished-code | `logic.ts`, `ui.tsx`, `logic.test.ts` or `worker.ts` still holds the generator's `TODO(new-tool)` marker. |
| faq-structure | The FAQ has fewer than two pairs, a question without `?`, or an answer under five words. |
| faq-repeats | A FAQ sentence of five words or more is also in the intro or another section. |
| unique-name-and-summary | Two tools have the same name once case, punctuation and word order are ignored, or summaries that reach 0.60 similarity. Page titles are built from the name. |
| near-duplicate | Two pages reach a similarity of 0.30. The measure is the Jaccard score of their word 4-shingles. |
| budget (after the build) | The initial or the on-demand JavaScript is over its budget. |

## The prompt to give Claude Code

Paste this into Claude Code, fill in the angle brackets, and delete the lines you do not need. It
makes the agent plan first, use the generator, and finish every part the gates check.

```text
Build the tool "<NAME>" for NetworksInsights.

Follow AGENTS.md. Show your full plan and wait for my approval before changing anything.
Read docs/adding-a-tool.md, docs/tool-contract.md and docs/design-system.md first.

WHAT IT DOES
<One or two sentences: what the visitor gives it, what they get back, who needs it.>

MANIFEST
- id: <tool-id>            kebab-case; it becomes the URL /<tool-id>/
- name: <Name>             up to 60 characters
- category: <category-id>  one of: pdf, image, video-audio, text, calculators, converters,
                           generators, developer, web-seo, color-design, date-time
- runtime: <client|worker|server>
- tags: <tag-one, tag-two> one to eight
- summary: <20 to 159 characters, unique>   (or write "propose one")
- related: <ids of existing tools to link, or "none">

BEHAVIOUR AND LIMITS
- <The options it has, the formats it accepts, the size limits, the edge cases.>
- accepts / produces: <file formats, or "none" for a tool that works on text or numbers>
- <What it must not do.>

HOW TO WORK
1. Use the branch tool/<tool-id>. Never commit to main. Never merge.
2. Create the folder with `pnpm new:tool`, giving every input as a flag. Never write the folder by hand.
3. Write logic.ts (pure), real tests in logic.test.ts, and the workspace in ui.tsx with components
   imported from "@ui". Heavy code goes behind a dynamic import() so the initial JavaScript stays
   under 40 KB gzip. Add no dependency without telling me why, its size and its license first.
   Give files back only with saveFile from "@ui", show visitor text as text ({value}), and never
   use innerHTML, dangerouslySetInnerHTML, eval or any other HTML or code sink. Never add a header,
   a CSP or a `security` field to the manifest without an ADR I have accepted.
4. Write content/en.mdx, following the AEO rules in docs/adding-a-tool.md: an intro of at least 40
   words whose first sentence says what the tool does, names the tool and has at most 30 words; then
   How to use (50), Examples (40), Limits (30) and an FAQ of at least two `###` questions, phrased
   as real user questions and ending in "?", with 60 words. Every sentence must be true
   of this tool alone. Do not invent counts, ratings, testimonials or claims. Do not copy another
   tool's page.
5. Remove every TODO(new-tool) marker.

DONE WHEN
`pnpm check:tools --tool <tool-id>`, `pnpm check`, `pnpm test:slow`, `pnpm build`,
`pnpm check:budgets` and `pnpm check:seo` all pass,
and the tool works in `pnpm dev`. Then push, open a pull request titled "<Name>", wait for green
checks, and do not merge.

REPORT
State: the files created; the tests and their results; the output of
`pnpm check:tools --tool <tool-id>` and `pnpm check:budgets`; anything you were unsure about.
```

## When something fails

| Message starts with | Usually means | Do this |
|---|---|---|
| `Tool contract: … is missing the required file` | A file was deleted or never created. | Create it. `pnpm new:tool` writes every required file. |
| `Tool contract: … island.astro must be the contract source` | `island.astro` was edited. | Restore it; tool code belongs in `ui.tsx`. |
| `Tool contract: … logic.ts …` | `logic.ts` is not pure. | Move DOM, network and Node code to `ui.tsx`. |
| `Quality gate "min-words"` | A section is too short. | Write more real prose; the message says how many words. |
| `Quality gate "placeholders"` | Placeholder text or an empty section. | Replace it with real content. |
| `Quality gate "near-duplicate"` | The page is too close to another tool's. | Rewrite it around what only this tool does. The message names both tools and the score. |
| `JavaScript budget: … initial island JavaScript` | Too much code loads with the page. | Move the heavy part behind `await import(...)`, or raise the budget with a reason. |
