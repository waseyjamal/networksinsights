import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CheckUsageError, checkTools, formatReport, reportToJson } from "./lib/check";
import { generateTool } from "./lib/generate";
import { finishTool, inputFor, scratchRoot, writeSyntheticTool } from "./lib/test-support";
import { repoRoot } from "./lib/tools";

// `pnpm check:tools`: every tool gate on its own, one readable summary, one tool at a time when
// asked. Each test builds a tool set in a temporary folder with the real generator.

const roots: Array<ReturnType<typeof scratchRoot>> = [];
function fresh() {
  const scratch = scratchRoot();
  roots.push(scratch);
  return scratch;
}
afterEach(() => {
  for (const scratch of roots.splice(0)) scratch.remove();
});

const today = "2026-09-21";

/** A generated tool, finished with one of the shared good pages. */
async function finished(tools: string, id: string, page: string, category = "text") {
  await generateTool(inputFor(id, { category }), { toolsRoot: tools, today });
  finishTool(join(tools, category, id), page);
}
/** A generated tool, left as the generator wrote it. */
const stub = (tools: string, id: string) => generateTool(inputFor(id), { toolsRoot: tools, today });

const problemsOf = (report: Awaited<ReturnType<typeof checkTools>>, gate: string) =>
  report.sections.find((section) => section.id === gate)?.violations ?? [];

describe("a finished tool set", () => {
  it("passes every gate", async () => {
    const { tools } = fresh();
    await finished(tools, "word-counter", "word-counter");
    await finished(tools, "character-counter", "character-counter");
    await finished(tools, "jpg-to-png", "jpg-to-png", "image");

    const report = await checkTools({ root: tools });
    expect(report.ok).toBe(true);
    expect(report.toolCount).toBe(3);
    expect(report.problemCount).toBe(0);
    expect(report.sections.map((section) => section.id)).toEqual([
      "contract",
      "purity",
      "safe-rendering",
      "security-override",
      "min-words",
      "answer-first",
      "answer-first-name",
      "placeholders",
      "unfinished-code",
      "faq-structure",
      "faq-repeats",
      "unique-name-and-summary",
      "near-duplicate",
    ]);
    expect(formatReport(report)).toContain("All checks pass");
    // The fixture tools' first sentences do not name the tool: advice, never a failure.
    expect(report.warningCount).toBeGreaterThan(0);
    expect(formatReport(report)).toContain("do not fail the check");
  });

  it("with no tools at all, passes and says why", async () => {
    const { tools } = fresh();
    const report = await checkTools({ root: tools });
    expect(report.ok).toBe(true);
    expect(report.toolCount).toBe(0);
    expect(formatReport(report)).toContain("There are no tools yet");
  });
});

describe("a tool that is not finished", () => {
  it("fails the quality gates, and each problem names the tool, the file and the fix", async () => {
    const { tools } = fresh();
    await stub(tools, "word-counter");
    const report = await checkTools({ root: tools });

    expect(report.ok).toBe(false);
    expect(problemsOf(report, "min-words").length).toBeGreaterThan(0);
    expect(problemsOf(report, "placeholders").length).toBeGreaterThan(0);
    expect(problemsOf(report, "unfinished-code")).toHaveLength(3);
    // The contract and purity are fine: a stub is a valid tool, only an unfinished one.
    expect(problemsOf(report, "contract")).toEqual([]);
    expect(problemsOf(report, "purity")).toEqual([]);

    const text = formatReport(report);
    expect(text).toContain("tools/text/word-counter");
    expect(text).toContain("File:    tools/text/word-counter/content/en.mdx");
    expect(text).toContain("Fix:");
    expect(text).toContain("pnpm check:tools --tool <tool-id>");
  });
});

describe("--tool: checking one tool among many", () => {
  it("reports only on that tool, whatever state the others are in", async () => {
    const { tools } = fresh();
    await finished(tools, "word-counter", "word-counter");
    await stub(tools, "case-converter");

    const good = await checkTools({ root: tools, tool: "word-counter" });
    expect(good.ok).toBe(true);
    expect(good.checked).toEqual(["tools/text/word-counter"]);
    expect(good.toolCount).toBe(2);
    expect(formatReport(good)).toContain("(of 2 tools)");

    const bad = await checkTools({ root: tools, tool: "case-converter" });
    expect(bad.ok).toBe(false);
    expect(new Set(bad.sections.flatMap((s) => s.violations).map((v) => v.dir))).toEqual(
      new Set(["tools/text/case-converter"]),
    );
  });

  it("still compares the tool with every other tool, so a copy is found from either side", async () => {
    const { tools } = fresh();
    await finished(tools, "word-counter", "word-counter");
    await finished(tools, "words-again", "word-counter");
    await finished(tools, "character-counter", "character-counter");

    const report = await checkTools({ root: tools, tool: "character-counter" });
    expect(report.ok).toBe(true);

    const copy = await checkTools({ root: tools, tool: "words-again" });
    const found = problemsOf(copy, "near-duplicate");
    expect(found).toHaveLength(1);
    expect(found[0]?.dir).toBe("tools/text/words-again");
    expect(found[0]?.problem).toContain("near-duplicate of word-counter");
    expect(found[0]?.problem).toContain("similarity 1.00");
  });

  it("says what to do when the id is wrong, and suggests close ids", async () => {
    const { tools } = fresh();
    await finished(tools, "word-counter", "word-counter");
    const error = await checkTools({ root: tools, tool: "word-count" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CheckUsageError);
    expect((error as Error).message).toContain('There is no tool with the id "word-count"');
    expect((error as Error).message).toContain("Did you mean: word-counter?");
  });
});

describe("the gates that are not about content", () => {
  it("purity: a logic.ts that touches the page fails, naming the file", async () => {
    const { tools } = fresh();
    await finished(tools, "word-counter", "word-counter");
    writeFileSync(
      join(tools, "text", "word-counter", "logic.ts"),
      "export function run(): string {\n  return document.title;\n}\n",
    );
    const report = await checkTools({ root: tools });
    const [problem] = problemsOf(report, "purity");
    expect(problem?.file).toBe("logic.ts");
    expect(problem?.problem).toContain("uses `document`");
    expect(problem?.fix).toContain("ui.tsx");
  });

  it("safe rendering: a ui.tsx that renders a string as HTML fails, naming the line", async () => {
    const { tools } = fresh();
    await finished(tools, "word-counter", "word-counter");
    writeFileSync(
      join(tools, "text", "word-counter", "ui.tsx"),
      "export default function Ui({ html }: { html: string }) {\n  return <div dangerouslySetInnerHTML={{ __html: html }} />;\n}\n",
    );
    const report = await checkTools({ root: tools });
    const [problem] = problemsOf(report, "safe-rendering");
    expect(report.ok).toBe(false);
    expect(problem?.file).toBe("ui.tsx");
    expect(problem?.problem).toContain("line 2: sets dangerouslySetInnerHTML");
    expect(problem?.fix).toContain("Rendering user text");
  });

  it("security override: a manifest must name an accepted ADR", async () => {
    // A tool id of its own: Node caches an imported config for the whole process.
    const { tools } = fresh();
    await finished(tools, "isolated-tool", "word-counter");
    const path = join(tools, "text", "isolated-tool", "tool.config.ts");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        "  related: [],\n",
        '  related: [],\n  security: { adr: "0999", crossOriginIsolated: true },\n',
      ),
    );
    const report = await checkTools({ root: tools });
    const [problem] = problemsOf(report, "security-override");
    expect(report.ok).toBe(false);
    expect(problem?.problem).toBe("security names there is no ADR 0999 in docs/adr/");
    expect(problem?.fix).toContain("docs/runbooks/security.md");
  });

  it("contract: a tampered island.astro fails with a fix", async () => {
    const { tools } = fresh();
    await finished(tools, "word-counter", "word-counter");
    writeFileSync(join(tools, "text", "word-counter", "island.astro"), "<div>tampered</div>\n");
    const report = await checkTools({ root: tools });
    expect(problemsOf(report, "contract")[0]?.problem).toContain("byte for byte");
    expect(problemsOf(report, "contract")[0]?.fix).toContain("restore the file");
  });

  it("contract: a tool.config.ts that cannot be imported is reported, not thrown", async () => {
    const { tools } = fresh();
    await finished(tools, "word-counter", "word-counter");
    writeFileSync(
      join(tools, "text", "word-counter", "tool.config.ts"),
      'throw new Error("this config is broken");\n',
    );
    const report = await checkTools({ root: tools });
    const [problem] = problemsOf(report, "contract");
    expect(problem?.problem).toContain("tool.config.ts could not be loaded: this config is broken");
  });
});

describe("raised JavaScript budgets", () => {
  const withBudget = (tools: string, budget: string, id = "word-counter") => {
    // Each test uses a tool id of its own: Node caches an imported config for the whole process.
    const path = join(tools, "text", id, "tool.config.ts");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        "  related: [],\n",
        `  related: [],\n  budget: ${budget},\n`,
      ),
    );
  };

  it("are listed, with the reason, so the owner can see who asked for more", async () => {
    const { tools } = fresh();
    await finished(tools, "word-counter", "word-counter");
    withBudget(tools, '{ maxInitialJsKb: 80, reason: "Bundles a small parser the tool needs." }');
    const report = await checkTools({ root: tools });
    expect(report.ok).toBe(true);
    expect(report.raisedBudgets).toEqual([
      {
        dir: "tools/text/word-counter",
        initialKb: 80,
        onDemandKb: 1024,
        reason: "Bundles a small parser the tool needs.",
      },
    ]);
    expect(formatReport(report)).toContain(
      "initial 80 KB, on demand 1024 KB — Bundles a small parser",
    );
  });

  it("are refused without a reason", async () => {
    const { tools } = fresh();
    await finished(tools, "no-reason", "word-counter");
    withBudget(tools, "{ maxInitialJsKb: 80 }", "no-reason");
    const report = await checkTools({ root: tools });
    expect(
      problemsOf(report, "contract")
        .map((v) => v.problem)
        .join("\n"),
    ).toContain("manifest field `budget.reason`");
  });

  it("are refused with a placeholder for a reason", async () => {
    const { tools } = fresh();
    await finished(tools, "placeholder-reason", "word-counter");
    withBudget(
      tools,
      '{ maxInitialJsKb: 80, reason: "TODO explain why this is needed" }',
      "placeholder-reason",
    );
    const report = await checkTools({ root: tools });
    expect(problemsOf(report, "placeholders")[0]?.problem).toContain(
      "manifest field `budget.reason` still has the placeholder text",
    );
  });

  it("cannot go past the ceiling, and cannot be set to the default", async () => {
    const { tools } = fresh();
    await finished(tools, "word-counter", "word-counter");
    withBudget(tools, '{ maxInitialJsKb: 251, reason: "Far too much code for a page." }');
    const over = await checkTools({ root: tools });
    expect(problemsOf(over, "contract")[0]?.problem).toContain(
      "must be at most 250 KB, the ceiling",
    );
  });
});

describe("the JSON form, for an agent", () => {
  it("has the gates, the problems with their files and fixes, and the verdict", async () => {
    const { tools } = fresh();
    await stub(tools, "word-counter");
    const json = JSON.parse(reportToJson(await checkTools({ root: tools })));
    expect(json.ok).toBe(false);
    expect(json.tools).toBe(1);
    const gate = json.gates.find((g: { id: string }) => g.id === "unfinished-code");
    expect(gate.ok).toBe(false);
    expect(gate.problems[0]).toMatchObject({
      tool: "tools/text/word-counter",
      file: expect.stringContaining("tools/text/word-counter/"),
      fix: expect.stringContaining("marker"),
    });
  });
});

describe("the command", () => {
  const run = (args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", "scripts/check-tools.ts", ...args], {
      cwd: repoRoot,
      encoding: "utf8",
    });

  it("exits 0 when everything passes, 1 when something needs fixing, 2 when used wrongly", {
    tags: ["slow"],
  }, async () => {
    const { tools } = fresh();
    await finished(tools, "word-counter", "word-counter");
    await stub(tools, "case-converter");

    expect(run(["--tools-root", tools, "--tool", "word-counter"]).status).toBe(0);
    const failing = run(["--tools-root", tools, "--tool", "case-converter"]);
    expect(failing.status).toBe(1);
    expect(failing.stdout).toContain("problems to fix");
    const wrong = run(["--tools-root", tools, "--tool", "nope"]);
    expect(wrong.status).toBe(2);
    expect(wrong.stderr).toContain('There is no tool with the id "nope"');
    expect(run(["--nonsense"]).status).toBe(2);
  });

  it("prints JSON that parses, with --json", { tags: ["slow"] }, async () => {
    const { tools } = fresh();
    await finished(tools, "word-counter", "word-counter");
    const result = run(["--tools-root", tools, "--json"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).ok).toBe(true);
  });

  it("passes on the real tools folder of this repository", { tags: ["slow"] }, () => {
    // The production site ships no tools until Mission 13, so this is the "0 tools" run CI does.
    const result = run([]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});

describe("at scale", () => {
  it("checks one tool among 150 quickly, and all 150 in a few seconds", {
    tags: ["slow"],
  }, async () => {
    const { tools } = fresh();
    for (let i = 0; i < 150; i++) writeSyntheticTool(tools, i);
    expect(existsSync(join(tools, "text", "tool-0000"))).toBe(true);

    const all = await checkTools({ root: tools });
    expect(all.problemCount, formatReport(all).slice(0, 600)).toBe(0);
    const one = await checkTools({ root: tools, tool: "tool-0075" });
    expect(one.ok).toBe(true);
    console.log(
      `150 tools: all ${Math.round(all.ms)} ms, one tool (--tool) ${Math.round(one.ms)} ms`,
    );
    expect(all.ms).toBeLessThan(30_000);
    expect(one.ms).toBeLessThan(30_000);
  });
});
