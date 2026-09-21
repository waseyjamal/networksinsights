// Helpers the tests of the scripts share: a scratch folder, and a way to turn a generated stub
// into a finished tool, so a test can start from what `pnpm new:tool` really writes.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ISLAND_SOURCE } from "@networksinsights/tool-sdk";
import { mulberry32 } from "../../packages/tool-sdk/src/quality/synthetic";
import type { NewToolInput } from "./generate";
import { repoRoot } from "./tools";

const scratch = join(repoRoot, "scripts", ".tmp");

/** A new empty folder under scripts/.tmp, which git ignores. `tools` is where tools go. */
export function scratchRoot(): { root: string; tools: string; remove: () => void } {
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "run-"));
  return {
    root,
    tools: join(root, "tools"),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

const pagesDir = join(repoRoot, "packages", "tool-sdk", "src", "quality", "fixtures", "pages");

/** The names of the finished fixture pages: `word-counter`, `jpg-to-png`, and so on. */
export const pageNames = readdirSync(pagesDir)
  .map((file) => file.replace(".mdx", ""))
  .sort();

/** The text of a finished fixture page. */
export const pageText = (name: string) => readFileSync(join(pagesDir, `${name}.mdx`), "utf8");

const WORDS =
  "amber anchor basil breeze cedar comet coral dune ember fern glacier harbor iris jade kelp lark maple nectar opal pebble quartz reed sable tundra umber velvet willow zephyr birch cobalt delta echo flint grove hazel indigo juniper lotus mesa nova orchid prism".split(
    " ",
  );

/** Eight words that depend on the id, so two test tools never have alike summaries. */
function wordsFor(id: string): string {
  let seed = 0;
  for (const char of id) seed = (Math.imul(seed, 31) + char.charCodeAt(0)) >>> 0;
  const random = mulberry32(seed);
  return Array.from({ length: 8 }, () => WORDS[Math.floor(random() * WORDS.length)]).join(" ");
}

/** A valid input for a tool, with a summary that is its own. */
export function inputFor(id: string, overrides: Partial<NewToolInput> = {}): NewToolInput {
  const name = id
    .split("-")
    .map((word, index) => (index === 0 ? word[0]?.toUpperCase() + word.slice(1) : word))
    .join(" ");
  return {
    id,
    name,
    category: "text",
    summary: `Test tool for ${wordsFor(id)} work in the browser.`,
    runtime: "client",
    tags: ["test"],
    ...overrides,
  };
}

/**
 * Turns a generated stub into a finished tool: real content, real logic, a real test, and no
 * marker left. What a person would do by hand, done in one call.
 */
export function finishTool(toolPath: string, page: string): void {
  writeFileSync(join(toolPath, "content", "en.mdx"), pageText(page));
  writeFileSync(
    join(toolPath, "logic.ts"),
    "export interface Input {\n  text: string;\n}\n\nexport interface Result {\n  output: string;\n}\n\nexport function run(input: Input): Result {\n  return { output: input.text.trim() };\n}\n",
  );
  writeFileSync(
    join(toolPath, "ui.tsx"),
    'import { Textarea } from "@ui";\nimport { run } from "./logic";\n\nexport default function ToolUi() {\n  return <Textarea id="input" label="Input" defaultValue={run({ text: " x " }).output} />;\n}\n',
  );
  writeFileSync(
    join(toolPath, "logic.test.ts"),
    'import { expect, it } from "vitest";\nimport { run } from "./logic";\n\nit("trims", () => {\n  expect(run({ text: " a " }).output).toBe("a");\n});\n',
  );
}

/**
 * Writes one finished-looking tool folder straight to disk, with a page of its own made from
 * seeded random words, so a test can build hundreds of tools quickly. Not for the generator's own
 * tests: those use `generateTool`.
 */
export function writeSyntheticTool(tools: string, index: number): { id: string; dir: string } {
  const id = `tool-${String(index).padStart(4, "0")}`;
  const dir = join(tools, "text", id);
  mkdirSync(join(dir, "content"), { recursive: true });
  const random = mulberry32(index + 1);
  const words = (count: number) =>
    Array.from({ length: count }, () => `w${Math.floor(3000 ** random())}`).join(" ");
  const input = inputFor(id, { summary: `Synthetic ${words(9)} tool for tests.` });
  writeFileSync(
    join(dir, "tool.config.ts"),
    `import { defineTool } from "@networksinsights/tool-sdk";\nimport { z } from "zod";\n\nexport default defineTool({\n  id: ${JSON.stringify(id)},\n  name: ${JSON.stringify(input.name)},\n  category: "text",\n  summary: ${JSON.stringify(input.summary)},\n  tags: ["test"],\n  runtime: "client",\n  status: "beta",\n  input: z.object({ text: z.string() }),\n  related: [],\n  added: "2026-09-21",\n  updated: "2026-09-21",\n});\n`,
  );
  writeFileSync(join(dir, "island.astro"), ISLAND_SOURCE);
  finishTool(dir, "word-counter");
  // finishTool wrote a shared page; put this tool's own words back.
  writeFileSync(
    join(dir, "content", "en.mdx"),
    `${words(10)}. ${words(50)}.\n\n## How to use\n\n${words(70)}.\n\n## Examples\n\n${words(60)}.\n\n## Limits\n\n${words(50)}.\n\n## FAQ\n\n### ${words(5)}?\n\n${words(40)}.\n\n### ${words(5)}?\n\n${words(40)}.\n`,
  );
  return { id, dir };
}
