import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { askForMissing, exampleCommand, toInput } from "./lib/prompt";
import { scratchRoot } from "./lib/test-support";
import { repoRoot } from "./lib/tools";

// `pnpm new:tool` as a person or an agent runs it: with flags, without a terminal, and with
// someone typing answers. The tools go to a scratch folder through --tools-root.

const roots: Array<ReturnType<typeof scratchRoot>> = [];
afterEach(() => {
  for (const scratch of roots.splice(0)) scratch.remove();
});

const run = (args: string[], tools?: string) =>
  spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/new-tool.ts", ...(tools ? ["--tools-root", tools] : []), ...args],
    { cwd: repoRoot, encoding: "utf8" },
  );

const flags = [
  "--id",
  "word-counter",
  "--name",
  "Word counter",
  "--category",
  "text",
  "--summary",
  "Count the words, characters and lines in any text, as you type.",
  "--runtime",
  "client",
  "--tags",
  "words,characters",
];

describe("with flags, and no terminal (what an AI agent does)", () => {
  it("creates the tool, then prints the next steps and the exact commands to check it", () => {
    const scratch = scratchRoot();
    roots.push(scratch);
    const result = run(flags, scratch.tools);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(scratch.tools, "text", "word-counter", "logic.ts"))).toBe(true);
    expect(result.stdout).toContain("Created tools/text/word-counter/ (beta, client runtime)");
    expect(result.stdout).toContain("Next steps");
    for (const command of [
      "pnpm check:tools --tool word-counter",
      "pnpm test tools/text/word-counter",
      "pnpm dev",
      "pnpm check && pnpm build && pnpm check:budgets",
    ]) {
      expect(result.stdout, command).toContain(command);
    }
  });

  it("with --json, prints one JSON document with the files and the next steps", () => {
    const scratch = scratchRoot();
    roots.push(scratch);
    const result = run([...flags, "--json"], scratch.tools);
    expect(result.status, result.stderr).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.dir).toBe("tools/text/word-counter");
    expect(json.files).toContain("content/en.mdx");
    expect(json.nextSteps.join("\n")).toContain("pnpm check:tools --tool word-counter");
  });

  it("with --dry-run, checks everything and writes nothing", () => {
    const scratch = scratchRoot();
    roots.push(scratch);
    const result = run([...flags, "--dry-run"], scratch.tools);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Nothing was written.");
    expect(existsSync(scratch.tools)).toBe(false);
  });

  it("refuses a bad input with every problem, an example for each, and exit code 1", () => {
    const scratch = scratchRoot();
    roots.push(scratch);
    const result = run(
      [
        "--id",
        "text-tools",
        "--name",
        "X",
        "--category",
        "text",
        "--summary",
        "short",
        "--runtime",
        "client",
        "--tags",
        "a",
      ],
      scratch.tools,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Nothing was created. 2 problems to fix");
    expect(result.stderr).toContain(
      "--summary: summary must be at least 20 characters. Example: --summary",
    );
    expect(result.stderr).toContain('--id: "text-tools" is the URL of the category page');
    expect(existsSync(scratch.tools)).toBe(false);
  });

  it("refuses to overwrite: the second run with the same id fails and changes nothing", () => {
    const scratch = scratchRoot();
    roots.push(scratch);
    expect(run(flags, scratch.tools).status).toBe(0);
    const second = run(flags, scratch.tools);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('a tool with the id "word-counter" already exists');
  });

  it("never waits for an answer: with an input missing and no terminal, it says how to fix it", () => {
    const result = run(["--id", "word-counter"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Missing --name, --category, --summary, --runtime, --tags");
    expect(result.stderr).toContain('Example: pnpm new:tool --name "Word counter" --category text');
  });

  it("with --json and a missing input, says so as JSON", () => {
    const result = run(["--json"]);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr).ok).toBe(false);
  });

  it("shows help with every flag, and rejects a flag it does not know", () => {
    const help = run(["--help"]);
    expect(help.status).toBe(0);
    for (const flag of [
      "--id",
      "--name",
      "--category",
      "--summary",
      "--runtime",
      "--tags",
      "--dry-run",
      "--json",
    ]) {
      expect(help.stdout, flag).toContain(flag);
    }
    const wrong = run(["--colour", "red"]);
    expect(wrong.status).toBe(2);
    expect(wrong.stderr).toContain("Usage: pnpm new:tool");
  });
});

describe("in a terminal, when an input is missing (someone typing)", () => {
  function typing(answers: string[]) {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = "";
    output.on("data", (chunk) => {
      text += String(chunk);
    });
    for (const answer of answers) input.write(`${answer}\n`);
    return { input, output, read: () => text };
  }

  it("asks for what is missing, one question at a time, and leaves the given flags alone", async () => {
    const { input, output, read } = typing(["Word counter", "text"]);
    const answers = await askForMissing({ id: "word-counter" }, ["name", "category"], {
      input,
      output,
    });
    expect(answers).toEqual({ id: "word-counter", name: "Word counter", category: "text" });
    expect(read()).toContain("Name shown on the page");
    expect(read()).toContain("Category (pdf, image");
  });

  it("asks again after a wrong answer, and says what was wrong", async () => {
    const { input, output, read } = typing(["text-tools", "text"]);
    const answers = await askForMissing({}, ["category"], { input, output });
    expect(answers.category).toBe("text");
    expect(read()).toContain('"text-tools" is not a category id');
    expect(read()).toContain('the category id is "text"');
  });

  it("checks tags as a list, and turns the answers into the generator's input", async () => {
    const { input, output } = typing(["Bad Tag", "words, characters"]);
    const answers = await askForMissing({}, ["tags"], { input, output });
    expect(toInput(answers).tags).toEqual(["words", "characters"]);
  });

  it("stops with a clear message if the input ends first", async () => {
    const { input, output } = typing(["Word counter"]);
    input.end();
    await expect(askForMissing({}, ["name", "id"], { input, output })).rejects.toThrow(
      "The input ended before every question was answered.",
    );
  });

  it("names the flags a caller without a terminal would use", () => {
    expect(exampleCommand(["id", "runtime"])).toBe(
      "pnpm new:tool --id word-counter --runtime client",
    );
  });
});
