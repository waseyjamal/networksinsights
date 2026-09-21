// The content quality gates (ADR 0036). Each one is a small pure function from the tool set to a
// list of problems, and each problem names the tool, the file, what is wrong and how to fix it.
//
// The registry runs them at build time, `pnpm check:tools` runs them on demand, and in `astro dev`
// they only warn (ADR 0036), so a tool that is still being written keeps rendering.

import { type ContentParts, readContent } from "../content";
import { toolManifestSchema } from "../manifest";
import type { ToolManifest } from "../types";
import type { ContractViolation, ToolEntry } from "../validate";
import { countProseWords, normalizeText, sentencesOf, toProse, wordsOf } from "./prose";
import {
  findSimilarPairs,
  findSimilarTo,
  NEAR_DUPLICATE_THRESHOLD,
  type SimilarPair,
  shingleSet,
} from "./similarity";

/** The word every generated stub carries in code and content, until a human finishes it. */
export const UNFINISHED_MARKER = "TODO(new-tool)";

/** The fewest words of prose each part of a page needs. Code blocks do not count. */
export const MIN_WORDS = {
  intro: 40,
  "How to use": 50,
  Examples: 40,
  Limits: 30,
  FAQ: 60,
} as const;

/** The fewest question-and-answer pairs in the FAQ, and the fewest words in one answer. */
export const FAQ_MIN_PAIRS = 2;
export const FAQ_MIN_ANSWER_WORDS = 5;

/** The most words the first sentence of the intro may have: the answer comes first (ADR 0044). */
export const FIRST_SENTENCE_MAX_WORDS = 30;

/** A FAQ sentence must be at least this long to count as repeated. Short ones repeat by chance. */
const REPEAT_MIN_WORDS = 5;

/** Two summaries at or above this Jaccard score on word pairs are near-identical. */
export const SUMMARY_SIMILARITY_THRESHOLD = 0.6;

/** One tool as the gates see it: a manifest that parsed, and the text of its files. */
export interface QualityEntry {
  dir: string;
  manifest: ToolManifest;
  /** The text of content/en.mdx. Absent when the file is missing, which the contract reports. */
  content: string | undefined;
  /** The code files, keyed by file name. */
  sources: Readonly<Record<string, string>>;
}

/** What a gate reads: the whole tool set, and which tools to report on. */
export interface QualityContext {
  entries: readonly QualityEntry[];
  /** Report only on these folders. Absent means every tool. Set-wide gates still compare all. */
  focus?: ReadonlySet<string> | undefined;
}

export interface QualityGate {
  /** Kebab-case, printed in every message: `Quality gate "min-words"`. */
  id: string;
  /** Short title for the summary. */
  title: string;
  /** The rule, in one sentence, for the summary and the docs. */
  rule: string;
  /**
   * "error" (the default) stops the build and fails `pnpm check:tools`. "warning" is printed and
   * never fails anything: it is advice a page can still ship without.
   */
  severity?: "error" | "warning";
  run(context: QualityContext): ContractViolation[];
}

/** The tools whose manifests parse. A tool with a broken manifest is the contract's business. */
export function toQualityEntries(entries: readonly ToolEntry[]): QualityEntry[] {
  return entries.flatMap((entry) => {
    const parsed = toolManifestSchema.safeParse(entry.manifest);
    if (!parsed.success) return [];
    return [
      {
        dir: entry.dir,
        manifest: parsed.data as ToolManifest,
        content: entry.content,
        sources: entry.sources ?? {},
      },
    ];
  });
}

const CONTENT_FILE = "content/en.mdx";
const CONFIG_FILE = "tool.config.ts";

const focused = (context: QualityContext): QualityEntry[] =>
  context.entries.filter((entry) => context.focus?.has(entry.dir) ?? true);

/** The parts of a page as [label, prose] pairs: the intro, then each H2 section. */
function partsOf(content: ContentParts): Array<{ label: string; body: string; isFaq: boolean }> {
  return [
    { label: "intro", body: content.intro, isFaq: false },
    ...content.parts.map((part) => ({
      label: part.name,
      body: part.body,
      isFaq: part.name === "FAQ",
    })),
  ];
}

const quote = (text: string, max = 70) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return `"${clean.length > max ? `${clean.slice(0, max - 1)}…` : clean}"`;
};

const percent = (score: number) => `${Math.round(score * 100)}%`;

// ---------------------------------------------------------------------------------------------
// min-words

const SECTION_ADVICE: Record<string, { what: string; example: string }> = {
  intro: {
    what: "Say what the tool does, who it is for and what makes it worth opening",
    example: "<Tool> turns <input> into <output>, in your browser. It suits <who>, because <why>.",
  },
  "How to use": {
    what: "Walk through the steps a visitor takes, in order, with the choices they meet",
    example: "1. Choose or paste <input>. 2. Pick <option>. 3. Copy or download the result.",
  },
  Examples: {
    what: "Show a real input and the exact output it gives, and say what to notice in it",
    example: "With <input>, the tool gives <output>, because <rule>.",
  },
  Limits: {
    what: "Say honestly what the tool cannot do: size, formats, accuracy, browser support",
    example: "It does not <thing>. Very large <inputs> may <effect>.",
  },
  FAQ: {
    what: "Answer the questions a visitor asks next, each under an H3 that ends in a question mark",
    example: "### Is my <input> uploaded?\nNo. The work happens <where>.",
  },
};

const minWords: QualityGate = {
  id: "min-words",
  title: "Enough real words in every section",
  rule: `Prose only, code blocks excluded: intro ${MIN_WORDS.intro}, How to use ${MIN_WORDS["How to use"]}, Examples ${MIN_WORDS.Examples}, Limits ${MIN_WORDS.Limits}, FAQ ${MIN_WORDS.FAQ} words.`,
  run(context) {
    const found: ContractViolation[] = [];
    for (const entry of focused(context)) {
      if (entry.content === undefined) continue;
      for (const part of partsOf(readContent(entry.content))) {
        const min = MIN_WORDS[part.label as keyof typeof MIN_WORDS];
        if (min === undefined) continue;
        const words = countProseWords(part.body);
        // An empty section is the placeholders gate's to report, with its own advice.
        if (words === 0 || words >= min) continue;
        const advice = SECTION_ADVICE[part.label];
        found.push({
          dir: entry.dir,
          gate: this.id,
          file: CONTENT_FILE,
          problem: `the ${part.label === "intro" ? "intro" : `"${part.label}" section`} has ${words} ${words === 1 ? "word" : "words"} of prose; the minimum is ${min}`,
          fix: `${advice?.what ?? "Write more"}. Add about ${min - words} more ${min - words === 1 ? "word" : "words"} of real prose; code blocks are not counted.`,
          ...(advice ? { example: advice.example } : {}),
        });
      }
    }
    return found;
  },
};

// ---------------------------------------------------------------------------------------------
// placeholders

const PLACEHOLDERS: RegExp[] = [
  /\bTODO\b/,
  /\bTBD\b/,
  /\bFIXME\b/,
  /lorem\s+ipsum|dolor\s+sit\s+amet/i,
  /coming\s+soon/i,
  /\bto\s+be\s+(?:written|added|completed|announced|determined|filled\s+in)\b/i,
  /\[\s*(?:insert|todo|tbd|placeholder)[^\]]*\]/i,
];

/** The first placeholder in a text, as written, or undefined. */
export function findPlaceholder(text: string): string | undefined {
  for (const pattern of PLACEHOLDERS) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return undefined;
}

const placeholders: QualityGate = {
  id: "placeholders",
  title: "No placeholder text and no empty section",
  rule: "No TODO, TBD, FIXME, lorem ipsum, “coming soon” or empty section in the prose of a page, and none in the name, summary or budget reason.",
  run(context) {
    const found: ContractViolation[] = [];
    for (const entry of focused(context)) {
      if (entry.content !== undefined) {
        for (const part of partsOf(readContent(entry.content))) {
          const prose = toProse(part.body);
          const where = part.label === "intro" ? "the intro" : `the "${part.label}" section`;
          if (wordsOf(prose).length === 0) {
            const advice = SECTION_ADVICE[part.label];
            found.push({
              dir: entry.dir,
              gate: this.id,
              file: CONTENT_FILE,
              problem: `${where} is empty`,
              fix: `${advice?.what ?? "Write it"}. Then keep going until it passes the minimum of ${MIN_WORDS[part.label as keyof typeof MIN_WORDS] ?? 1} words.`,
              ...(advice ? { example: advice.example } : {}),
            });
            continue;
          }
          const placeholder = findPlaceholder(prose);
          if (placeholder !== undefined) {
            found.push({
              dir: entry.dir,
              gate: this.id,
              file: CONTENT_FILE,
              problem: `${where} still has the placeholder text ${quote(placeholder)}`,
              fix: "Replace it with real content that is true of this tool. A page with placeholders must not ship.",
            });
          }
        }
      }
      const fields: Array<[string, string]> = [
        ["name", entry.manifest.name],
        ["summary", entry.manifest.summary],
        ...(entry.manifest.budget
          ? [["budget.reason", entry.manifest.budget.reason] as [string, string]]
          : []),
      ];
      for (const [field, value] of fields) {
        const placeholder = findPlaceholder(value);
        if (placeholder === undefined) continue;
        found.push({
          dir: entry.dir,
          gate: this.id,
          file: CONFIG_FILE,
          problem: `manifest field \`${field}\` still has the placeholder text ${quote(placeholder)}`,
          fix: `Write the real ${field}.`,
        });
      }
    }
    return found;
  },
};

// ---------------------------------------------------------------------------------------------
// unfinished-code

const unfinishedCode: QualityGate = {
  id: "unfinished-code",
  title: "No generator stub left in the code",
  rule: `${UNFINISHED_MARKER} must not remain in logic.ts, ui.tsx, logic.test.ts or worker.ts.`,
  run(context) {
    const found: ContractViolation[] = [];
    for (const entry of focused(context)) {
      for (const [file, source] of Object.entries(entry.sources)) {
        const index = source.indexOf(UNFINISHED_MARKER);
        if (index === -1) continue;
        const line = source.slice(0, index).split("\n").length;
        found.push({
          dir: entry.dir,
          gate: this.id,
          file,
          problem: `${file} still has the generator's ${UNFINISHED_MARKER} marker on line ${line}`,
          fix: "Write the code that the marker asks for, then delete the marker. `pnpm new:tool` leaves it so unfinished tools cannot ship.",
        });
      }
    }
    return found;
  },
};

// ---------------------------------------------------------------------------------------------
// faq-structure

interface FaqPair {
  question: string;
  answer: string;
}

/** The question-and-answer pairs of a FAQ section: each `###` heading and the text under it. */
export function parseFaq(body: string): FaqPair[] {
  const pairs: Array<{ question: string; lines: string[] }> = [];
  let inFence = false;
  for (const line of body.replaceAll("\r\n", "\n").split("\n")) {
    if (/^\s*(?:```|~~~)/.test(line)) inFence = !inFence;
    const heading = inFence ? null : /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      pairs.push({ question: heading[1] ?? "", lines: [] });
      continue;
    }
    pairs.at(-1)?.lines.push(line);
  }
  return pairs.map((pair) => ({ question: pair.question, answer: pair.lines.join("\n").trim() }));
}

const faqStructure: QualityGate = {
  id: "faq-structure",
  title: "FAQ is real question-and-answer pairs",
  rule: `At least ${FAQ_MIN_PAIRS} pairs; each question is an H3 that ends in “?”, each answer has at least ${FAQ_MIN_ANSWER_WORDS} words.`,
  run(context) {
    const found: ContractViolation[] = [];
    for (const entry of focused(context)) {
      if (entry.content === undefined) continue;
      const faq = readContent(entry.content).parts.find((part) => part.name === "FAQ");
      if (!faq) continue;
      const pairs = parseFaq(faq.body);
      const base = { dir: entry.dir, gate: this.id, file: CONTENT_FILE };
      if (pairs.length < FAQ_MIN_PAIRS) {
        found.push({
          ...base,
          problem: `the "FAQ" section has ${pairs.length} question-and-answer ${pairs.length === 1 ? "pair" : "pairs"}; the minimum is ${FAQ_MIN_PAIRS}`,
          fix: "Write each question as an H3 heading, and the answer as a paragraph under it.",
          example:
            "### Is my file uploaded?\nNo. The work happens in your browser, so the file stays on your device.",
        });
      }
      for (const pair of pairs) {
        if (!pair.question.endsWith("?")) {
          found.push({
            ...base,
            problem: `the FAQ question ${quote(pair.question)} does not end with a question mark`,
            fix: "Write it as a question a visitor would ask, ending in “?”.",
          });
        }
        const words = countProseWords(pair.answer);
        if (words < FAQ_MIN_ANSWER_WORDS) {
          found.push({
            ...base,
            problem: `the answer to ${quote(pair.question)} has ${words} ${words === 1 ? "word" : "words"}; the minimum is ${FAQ_MIN_ANSWER_WORDS}`,
            fix: "Answer in full sentences under the question's H3 heading.",
          });
        }
      }
    }
    return found;
  },
};

// ---------------------------------------------------------------------------------------------
// faq-repeats

const faqRepeats: QualityGate = {
  id: "faq-repeats",
  title: "The FAQ does not repeat the page",
  rule: `No FAQ sentence of ${REPEAT_MIN_WORDS} words or more may appear in the intro or another section.`,
  run(context) {
    const found: ContractViolation[] = [];
    for (const entry of focused(context)) {
      if (entry.content === undefined) continue;
      const parts = partsOf(readContent(entry.content));
      const elsewhere = new Map<string, string>();
      for (const part of parts) {
        if (part.isFaq) continue;
        for (const sentence of sentencesOf(toProse(part.body))) {
          const key = normalizeText(sentence);
          if (wordsOf(key).length >= REPEAT_MIN_WORDS && !elsewhere.has(key)) {
            elsewhere.set(key, part.label);
          }
        }
      }
      for (const part of parts.filter((candidate) => candidate.isFaq)) {
        const reported = new Set<string>();
        for (const sentence of sentencesOf(toProse(part.body))) {
          const key = normalizeText(sentence);
          const source = elsewhere.get(key);
          if (source === undefined || reported.has(key)) continue;
          reported.add(key);
          found.push({
            dir: entry.dir,
            gate: this.id,
            file: CONTENT_FILE,
            problem: `the FAQ repeats a sentence from ${source === "intro" ? "the intro" : `the "${source}" section`}: ${quote(sentence)}`,
            fix: "Answer the question with new information, or drop the question. A FAQ that restates the page adds words, not value.",
          });
        }
      }
    }
    return found;
  },
};

// ---------------------------------------------------------------------------------------------
// unique-name-and-summary

const nameKey = (name: string) => [...new Set(wordsOf(name.toLowerCase()))].sort().join(" ");

const uniqueNameAndSummary: QualityGate = {
  id: "unique-name-and-summary",
  title: "Unique names, titles and summaries",
  rule: `No two tools share a name once case, punctuation and word order are ignored, and no two summaries reach ${SUMMARY_SIMILARITY_THRESHOLD} similarity. The page title is built from the name, so unique names give unique titles.`,
  run(context) {
    const found: ContractViolation[] = [];
    const { entries } = context;

    const byName = new Map<string, QualityEntry[]>();
    for (const entry of entries) {
      const key = nameKey(entry.manifest.name);
      byName.set(key, [...(byName.get(key) ?? []), entry]);
    }
    for (const group of byName.values()) {
      if (group.length < 2) continue;
      for (const entry of group) {
        if (!(context.focus?.has(entry.dir) ?? true)) continue;
        const other = group.find((candidate) => candidate !== entry);
        found.push({
          dir: entry.dir,
          gate: this.id,
          file: CONFIG_FILE,
          problem: `name "${entry.manifest.name}" is the same as the name of ${other?.manifest.id} (${other?.dir}), so their page titles are the same`,
          fix: "Give the tool a name that says how it differs: what it takes in and what it gives out.",
          example: 'name: "PNG to JPG converter"',
        });
      }
    }

    const summaries = entries.map((entry) => ({
      entry,
      normal: normalizeText(entry.manifest.summary),
      set: shingleSet(wordsOf(entry.manifest.summary), 2),
    }));
    const sets = summaries.map((summary) => summary.set);
    const pairs: SimilarPair[] = context.focus
      ? entries.flatMap((entry, index) =>
          context.focus?.has(entry.dir)
            ? findSimilarTo(sets, index, SUMMARY_SIMILARITY_THRESHOLD)
            : [],
        )
      : findSimilarPairs(sets, SUMMARY_SIMILARITY_THRESHOLD);
    const seen = new Set<string>();
    for (const { a, b, score } of pairs) {
      const first = summaries[a];
      const second = summaries[b];
      if (!first || !second || seen.has(`${a}:${b}`)) continue;
      seen.add(`${a}:${b}`);
      // Identical summaries are a contract error, with their own message.
      if (first.normal === second.normal) continue;
      for (const [self, other] of [
        [first, second],
        [second, first],
      ] as const) {
        if (!(context.focus?.has(self.entry.dir) ?? true)) continue;
        found.push({
          dir: self.entry.dir,
          gate: this.id,
          file: CONFIG_FILE,
          problem: `summary is ${percent(score)} the same as the summary of ${other.entry.manifest.id} (${other.entry.dir}); the limit is ${percent(SUMMARY_SIMILARITY_THRESHOLD)}`,
          fix: "Rewrite the summary around what only this tool does. It is the meta description, so search results show it next to the other tool's.",
        });
      }
    }
    return found;
  },
};

// ---------------------------------------------------------------------------------------------
// near-duplicate

/** The prose of a whole page, without the fixed headings every page shares. */
export function pageWords(content: string): string[] {
  const parts = readContent(content);
  return wordsOf(toProse([parts.intro, ...parts.parts.map((part) => part.body)].join("\n")));
}

const nearDuplicate: QualityGate = {
  id: "near-duplicate",
  title: "No near-duplicate pages",
  rule: `No two pages may reach a similarity of ${NEAR_DUPLICATE_THRESHOLD.toFixed(2)}: the Jaccard score of their word 4-shingles (ADR 0036).`,
  run(context) {
    const withContent = context.entries.filter((entry) => entry.content !== undefined);
    const sets = withContent.map((entry) => shingleSet(pageWords(entry.content ?? "")));
    const pairs: SimilarPair[] = context.focus
      ? withContent.flatMap((entry, index) =>
          context.focus?.has(entry.dir) ? findSimilarTo(sets, index, NEAR_DUPLICATE_THRESHOLD) : [],
        )
      : findSimilarPairs(sets, NEAR_DUPLICATE_THRESHOLD);

    const found: ContractViolation[] = [];
    const seen = new Set<string>();
    for (const { a, b, score } of pairs) {
      const first = withContent[a];
      const second = withContent[b];
      if (!first || !second || seen.has(`${a}:${b}`)) continue;
      seen.add(`${a}:${b}`);
      for (const [self, other] of [
        [first, second],
        [second, first],
      ] as const) {
        if (!(context.focus?.has(self.dir) ?? true)) continue;
        found.push({
          dir: self.dir,
          gate: this.id,
          file: CONTENT_FILE,
          problem: `the page is a near-duplicate of ${other.manifest.id} (${other.dir}): similarity ${score.toFixed(2)}, the limit is ${NEAR_DUPLICATE_THRESHOLD.toFixed(2)}`,
          fix: `Rewrite ${self.manifest.id}'s page so it says things only true of this tool: its own steps, worked examples, limits and questions. Swapping the tool name in a shared template does not make a page different.`,
        });
      }
    }
    return found;
  },
};

// ---------------------------------------------------------------------------------------------
// answer-first, answer-first-name (ADR 0044)

/** The first sentence of a page's intro, as prose. Empty when the intro has none. */
export function firstSentence(intro: string): string {
  // toProse leaves a space where inline markup was, so "`numbers`." reads "numbers ."
  return (sentencesOf(toProse(intro))[0] ?? "").replace(/\s+([.,;:!?])/g, "$1");
}

const answerFirst: QualityGate = {
  id: "answer-first",
  title: "The intro answers first, in one short sentence",
  rule: `The first sentence of the intro has at most ${FIRST_SENTENCE_MAX_WORDS} words, so a reader (or an answer engine) gets the answer before anything else.`,
  run(context) {
    const found: ContractViolation[] = [];
    for (const entry of focused(context)) {
      if (entry.content === undefined) continue;
      const sentence = firstSentence(readContent(entry.content).intro);
      const words = wordsOf(sentence).length;
      // An empty intro is the placeholders gate's to report, with its own advice.
      if (words <= FIRST_SENTENCE_MAX_WORDS) continue;
      found.push({
        dir: entry.dir,
        gate: this.id,
        file: CONTENT_FILE,
        problem: `the first sentence of the intro has ${words} words; the maximum is ${FIRST_SENTENCE_MAX_WORDS}: ${quote(sentence)}`,
        fix: `Start the intro with one sentence that says what the tool does, in at most ${FIRST_SENTENCE_MAX_WORDS} words. Move the rest (who it is for, why it is worth opening) into the sentences after it.`,
        example:
          "<Tool name> turns <input> into <output>, in your browser. It suits <who>, because <why>.",
      });
    }
    return found;
  },
};

const answerFirstName: QualityGate = {
  id: "answer-first-name",
  title: "The first sentence of the intro names the tool",
  rule: "The first sentence of the intro contains the tool's name. A warning, never a failure: some good sentences answer without repeating the name.",
  severity: "warning",
  run(context) {
    const found: ContractViolation[] = [];
    for (const entry of focused(context)) {
      if (entry.content === undefined) continue;
      const sentence = firstSentence(readContent(entry.content).intro);
      if (sentence === "") continue;
      const name = normalizeText(entry.manifest.name);
      if (name === "" || ` ${normalizeText(sentence)} `.includes(` ${name} `)) continue;
      found.push({
        dir: entry.dir,
        gate: this.id,
        file: CONTENT_FILE,
        problem: `the first sentence of the intro does not contain the tool's name "${entry.manifest.name}": ${quote(sentence)}`,
        fix: "Name the tool in the first sentence, so the answer stands on its own when it is quoted away from the page. Ignore this warning if the sentence reads better without the name.",
        example: `${entry.manifest.name} turns <input> into <output>, in your browser.`,
      });
    }
    return found;
  },
};

/** Every quality gate, in the order the summary prints them. */
export const QUALITY_GATES: readonly QualityGate[] = [
  minWords,
  answerFirst,
  answerFirstName,
  placeholders,
  unfinishedCode,
  faqStructure,
  faqRepeats,
  uniqueNameAndSummary,
  nearDuplicate,
];

/** One gate and what it found. */
export interface GateResult {
  gate: QualityGate;
  violations: ContractViolation[];
}

/** Runs every gate, or the ones named, and keeps the results apart, gate by gate. */
export function runQualityGates(
  entries: readonly ToolEntry[],
  options: { focus?: readonly string[]; gates?: readonly string[] } = {},
): GateResult[] {
  const context: QualityContext = {
    entries: toQualityEntries(entries),
    focus: options.focus ? new Set(options.focus) : undefined,
  };
  return QUALITY_GATES.filter((gate) => options.gates?.includes(gate.id) ?? true).map((gate) => ({
    gate,
    violations: gate.run(context).sort((a, b) => a.dir.localeCompare(b.dir)),
  }));
}

/**
 * Every problem the quality gates find, in folder order. Empty means the content is ready. Gates
 * that only warn are left out: see checkQualityWarnings.
 */
export function checkQuality(
  entries: readonly ToolEntry[],
  options: { focus?: readonly string[]; gates?: readonly string[] } = {},
): ContractViolation[] {
  return runQualityGates(entries, options)
    .filter((result) => result.gate.severity !== "warning")
    .flatMap((result) => result.violations)
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

/** The advice from the gates that only warn, in folder order. It never fails anything. */
export function checkQualityWarnings(
  entries: readonly ToolEntry[],
  options: { focus?: readonly string[] } = {},
): ContractViolation[] {
  return runQualityGates(entries, options)
    .filter((result) => result.gate.severity === "warning")
    .flatMap((result) => result.violations)
    .sort((a, b) => a.dir.localeCompare(b.dir));
}
