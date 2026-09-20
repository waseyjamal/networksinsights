# 0036. Content quality gates

Status: Accepted
Date: 2026-09-21
Supersedes: [0018](0018-content-quality-gates.md)

## Context

ADR 0018 decided that thin or duplicated tool pages must fail the build. It set no thresholds, and
ADR 0033 built only the structural half (the intro and the four sections in order). At 500 or more
tools, most of them written by an AI agent from a prompt, the risks are specific: a page that is a
heading and a sentence, a page that still says "TODO", a page that is another tool's page with the
name changed, and an FAQ that restates the page above it.

## Decision

Seven gates run over every tool, as pure functions in the SDK (`packages/tool-sdk/src/quality/`).
Each problem names the tool, the file, what is wrong, a fix and, where it helps, an example.

### Where they run, and what happens

| Where | Contract and purity | Quality gates |
|---|---|---|
| `pnpm build`, `pnpm check:tools`, CI | hard failure | hard failure |
| `astro dev` | hard failure | **warning**, the page still renders |

A tool that is being written must not block the owner: in `astro dev` the quality problems print as
one warning, naming every problem and the command to check one tool, and the page renders. The
contract and purity stay hard in dev too, because a tampered `island.astro` or a `logic.ts` that
touches the DOM breaks rendering. The mode is chosen in one place (`qualityMode(import.meta.env.DEV)`)
and both are tested.

### Words

Counted in prose only: fenced code blocks, MDX imports and exports, JSX and HTML tags, comments,
frontmatter and link addresses are removed; headings, list items, link text and inline code stay.
A word is letters and digits, with inner hyphens and apostrophes kept.

| Part | Minimum | Why |
|---|---|---|
| Intro | 40 | Enough for what it does, who it is for, and what makes it worth opening. |
| How to use | 50 | A real sequence of steps with the choices a visitor meets. |
| Examples | 40 | A worked input and output, and a sentence on what to notice. |
| Limits | 30 | Two or three honest limits. A tool with no limits has not been thought about. |
| FAQ | 60 words, 2 pairs | Two answers of a few sentences each. A pair is an `###` question ending in `?` and an answer of at least 5 words. |

Together that is about 220 words of prose, roughly a page a person reads in a minute: the least
that makes a page more than a heading with a widget. The minimums are floors, not targets. They
are set so that every fixture page, written naturally and briefly, passes, and a stub does not.

### Placeholders

`TODO`, `TBD`, `FIXME`, "lorem ipsum" and "dolor sit amet", "coming soon", "to be written",
"to be added", "to be completed", `[insert …]`, and an empty section fail. They are matched in
prose, so a lorem-ipsum generator can show its output in a code block. They are matched in the
name, the summary and a budget reason too. Separately, the marker `TODO(new-tool)` fails in
`logic.ts`, `ui.tsx`, `logic.test.ts` and `worker.ts`, so a generated stub cannot ship.

### Unique names, titles and summaries

The page title is `<name> — Free online tool | NetworksInsights`, so unique names give unique
titles. Two names are the same when their words, lowercased and without punctuation, are the same
in any order. Two summaries are near-identical at a Jaccard score of **0.60** or more on word
pairs. Exactly equal summaries are already a contract error and are left to it.

### The FAQ does not repeat the page

A FAQ sentence of five words or more that, after case, punctuation and spacing are ignored, is also
in the intro or another section fails. Shorter sentences repeat by chance.

### Near-duplicate pages

**Measure.** Each page is its prose without the four fixed headings. Its words are lowercased and
cut into shingles of four consecutive words, each hashed to 32 bits. The similarity of two pages is
the Jaccard score of their shingle sets: shared shingles over all shingles, 0 (nothing in common)
to 1 (identical). The words are compared in order, so two pages that merely use the same
vocabulary score near 0, and two pages that share whole sentences score high.

**Speed.** Comparing all pairs is n²/2 set merges. MinHash sketches (256 hashes per page) and
locality-sensitive hashing (128 bands of 2 rows) pick the candidate pairs, and only candidates are
scored, exactly. A pair with score s is a candidate with probability 1 − (1 − s²)^128, which is
0.99999 at 0.30 and higher above it, so the fast path all but never loses a pair at the threshold.
The tests compare it with the all-pairs result on synthetic sets with planted copies and require
the identical list of pairs, with the identical scores.

**Measured time, 1,000 synthetic tools** (250-word pages, a small pool of shared boilerplate
sentences, 20 planted copies), on the owner's Windows 10 machine:

| | Time |
|---|---|
| Shingling 1,000 pages | 190 ms |
| Sketches, candidates and exact scores | 754 ms |
| **Total, fast path** | **944 ms** |
| All 499,500 pairs compared exactly | 5,746 ms |

`pnpm check:tools --tool <id>` skips the sketches and compares the one page with every other
exactly, in a single pass.

**Threshold: 0.30.** Calibrated on eight fixture pages for four pairs of closely related tools,
written separately, and on copies made from one of them:

| Comparison | Score |
|---|---|
| JPG to PNG vs PNG to JPG, written separately | 0.000 |
| Word counter vs Character counter, written separately | 0.000 |
| Base64 encode vs Base64 decode, written separately | 0.002 |
| Merge PDF vs Split PDF, written separately | 0.009 |
| JPG to PNG vs the same page with only the tool names swapped | 0.665 |
| Same page, 4 of its 5 parts copied, the rest from the other page | 0.565 |
| Same page, 1 sentence in 3 replaced | 0.496 |
| Same page, 3 of 5 parts copied | 0.381 |
| Same page, 1 sentence in 2 replaced | 0.374 |
| Same page, 2 of 5 parts copied | 0.239 |
| Same page, 1 of 5 parts copied | 0.088 |

"Similar topic" scores under 0.01; "copied template" scores 0.37 and up. The provisional threshold
was 0.40. The data moved it: at 0.40 a page that copies three of its five parts (0.381) or half of
its sentences (0.374) passes, and those are copies. 0.30 fails those, and still passes a page that
shares two of five parts (0.239), which is as much as a page can legitimately share (a privacy
answer, a limit that is the same for a family of tools). The fixtures are the same-author, similar-
structure case, the hardest honest case for a false positive; real independent pages will score
lower. If a real page is refused unfairly, the answer is to rewrite it, not to raise the threshold.

The pages and the calibration test are in `packages/tool-sdk/src/quality/fixtures/pages/` and
`similarity.test.ts`; the test fails if 3 of 5 copied parts stops failing or 2 of 5 stops passing.

### Fixtures

Every gate has a passing and a failing fixture, in
`packages/tool-sdk/src/quality/fixtures/gates/<gate>/{pass,fail}/`, run through that gate alone. A
test fails if a gate has no fixture of either kind, or a fixture has no gate. All eight fixture
pages together pass every content gate.

## Consequences

- An agent that writes a thin, copied or unfinished page cannot merge it: `pnpm check`, the
  pre-push hook and CI all run `pnpm check:tools`, and `pnpm build` runs the same gates.
- A page with a word floor can still be bad. The floor keeps out the worst; review still reads it.
- The gates read English. A second language (ADR 0023) needs its own words-per-section floors and
  its own placeholder list; the word counter already counts letters in any script.
- Full `pnpm check:tools` imports every `tool.config.ts`. `--tool <id>` imports only that one and
  reads the others' names and summaries as text (scripts/lib/static-manifest.ts). Measured on 1,000
  synthetic tools on the owner's machine, cold, 3 runs each: `--tool` took 5.5 to 7.6 s (about 3 s
  of it the fixed start-up of the script) and the full check took 22 to 43 s, depending on what
  else the machine was doing. That is acceptable for CI and tolerable in the pre-push hook at 500
  tools; see "Revisit when".

## Revisit when

A page that is honest and independent is refused by `near-duplicate` (raise the threshold with the
score and both pages in the ADR), the tool count passes a few thousand and the full check is slow
(read every manifest as text, as `--tool` does), or a second language is enabled.
