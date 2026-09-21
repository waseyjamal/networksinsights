// The questions `pnpm new:tool` asks in a terminal when an input was not given as a flag.
// The streams are parameters so a test can play the part of the person typing.

import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { checkField, type NewToolInput, parseTags } from "./generate";
import { siteConfig } from "./tools";

export const FIELDS = ["id", "name", "category", "summary", "runtime", "tags"] as const;
export type Field = (typeof FIELDS)[number];

/** The raw answers, as typed: `tags` is still the comma-separated text. */
export type Answers = Partial<Record<Field, string>>;

export const PROMPTS: Record<Field, string> = {
  id: "Tool id (kebab-case, becomes the URL), e.g. word-counter",
  name: "Name shown on the page, e.g. Word counter",
  category: `Category (${siteConfig.categoryIds.join(", ")})`,
  summary: "Summary, one sentence of 20 to 159 characters (the meta description)",
  runtime: "Runtime (client, worker or server)",
  tags: "Tags, separated by commas, e.g. words,characters",
};

/** The flag that gives each input, with a correct example value. */
export const EXAMPLE_FLAGS: Record<Field, string> = {
  id: "--id word-counter",
  name: '--name "Word counter"',
  category: `--category ${siteConfig.categoryIds.includes("text") ? "text" : (siteConfig.categoryIds[0] ?? "text")}`,
  summary: '--summary "Count the words, characters and lines in any text, as you type."',
  runtime: "--runtime client",
  tags: "--tags words,characters",
};

/** The example command for whatever is still missing, so a caller that cannot be asked can fix it. */
export function exampleCommand(missing: readonly Field[]): string {
  return `pnpm new:tool ${missing.map((field) => EXAMPLE_FLAGS[field]).join(" ")}`;
}

/** Turns the answers into the generator's input. Tags are split on commas. */
export function toInput(answers: Answers): NewToolInput {
  return {
    id: answers.id ?? "",
    name: answers.name ?? "",
    category: answers.category ?? "",
    summary: answers.summary ?? "",
    runtime: answers.runtime ?? "",
    tags: parseTags(answers.tags ?? ""),
  };
}

/**
 * Asks for each missing input, one at a time, and asks again until the answer is valid, so a typo
 * costs one line and not the whole run. Throws if the input ends before every question is answered.
 */
export async function askForMissing(
  answers: Answers,
  missing: readonly Field[],
  streams: { input: Readable; output: Writable },
): Promise<Answers> {
  const rl = createInterface({ input: streams.input, output: streams.output });
  // Lines are read through an iterator, which keeps every line the input has produced. Waiting on
  // one question at a time would lose a line that arrives while the previous answer is checked.
  const lines = rl[Symbol.asyncIterator]();

  const result: Answers = { ...answers };
  try {
    for (const field of missing) {
      for (;;) {
        streams.output.write(`${PROMPTS[field]}
> `);
        const next = await lines.next();
        if (next.done) throw new Error("The input ended before every question was answered.");
        const answer = String(next.value).trim();
        const problem = checkField(field, field === "tags" ? parseTags(answer) : answer);
        if (problem === undefined) {
          result[field] = answer;
          break;
        }
        streams.output.write(`  ${problem}

`);
      }
    }
  } finally {
    rl.close();
  }
  return result;
}
