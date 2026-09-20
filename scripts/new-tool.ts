// pnpm new:tool: creates the complete folder of a new tool (ADR 0035).
//
// Interactive when run in a terminal with something missing: it asks. Non-interactive when every
// input is given as a flag, or when there is no terminal (an AI agent, CI): it never waits.
//
//   pnpm new:tool --id word-counter --name "Word counter" --category text \
//     --summary "Count the words, characters and lines in any text, as you type." \
//     --runtime client --tags words,characters
//
// Exit codes: 0 created (or dry run passed), 1 refused or failed, 2 the command was used wrongly.

import { parseArgs } from "node:util";
import { type GenerateResult, GeneratorError, generateTool, stagingDirFor } from "./lib/generate";
import { type Answers, askForMissing, exampleCommand, FIELDS, toInput } from "./lib/prompt";
import { defaultToolsRoot, siteConfig } from "./lib/tools";

const HELP = `Usage: pnpm new:tool [options]

Creates tools/<category>/<id>/ with every required file. Missing inputs are asked for in a
terminal; without a terminal, or with every flag given, it never waits.

Options:
  --id <id>            kebab-case; the folder name and the URL (/<id>/)
  --name <name>        display name, up to 60 characters; the page title and H1
  --category <id>      a category id: ${siteConfig.categoryIds.join(", ")}
  --summary <text>     20 to 159 characters; the meta description, unique across tools
  --runtime <runtime>  client, worker or server (decides the privacy statement)
  --tags <a,b,c>       one to eight kebab-case tags, separated by commas
  --dry-run            check everything and print what would be written; write nothing
  --json               print the result as JSON, for an agent or a script
  --tools-root <path>  create the tool under another folder than tools/ (used by the tests)
  --help               show this text

Example:
  pnpm new:tool --id word-counter --name "Word counter" --category text \\
    --summary "Count the words, characters and lines in any text, as you type." \\
    --runtime client --tags words,characters`;

function nextSteps(result: GenerateResult, id: string): string[] {
  const dir = result.dir;
  const lines = [
    `Created ${dir}/ (beta, ${result.runtime} runtime) with:`,
    ...result.files.map((file) => `  ${file}`),
    "",
    "Next steps",
    `  1. Write the logic in ${dir}/logic.ts, then replace the failing test in logic.test.ts.`,
    `  2. Build the workspace in ${dir}/ui.tsx with the design-system components ("@ui").`,
    `  3. Write ${dir}/content/en.mdx: the intro, How to use, Examples, Limits and FAQ.`,
    "     Every TODO(new-tool) marker must be gone before the tool can ship.",
  ];
  if (result.runtime === "worker") {
    lines.push("  4. worker.ts is a stub; the worker runtime is wired up in Mission 14.");
  }
  if (result.runtime === "server") {
    lines.push(
      "  4. The server runtime is wired up in Mission 15; keep the logic pure until then.",
    );
  }
  lines.push(
    "",
    "Check your work",
    `  pnpm check:tools --tool ${id}   the contract, purity and content gates for this tool`,
    `  pnpm test ${dir}   its tests`,
    `  pnpm dev   then open http://localhost:4321/${id}/ (content problems only warn while you write)`,
    "  pnpm check && pnpm build && pnpm check:budgets   everything, as CI runs it",
  );
  return lines;
}

async function main(): Promise<number> {
  let flags: Answers & {
    "dry-run"?: boolean | undefined;
    json?: boolean | undefined;
    help?: boolean | undefined;
    "tools-root"?: string | undefined;
  };
  try {
    ({ values: flags } = parseArgs({
      options: {
        id: { type: "string" },
        name: { type: "string" },
        category: { type: "string" },
        summary: { type: "string" },
        runtime: { type: "string" },
        tags: { type: "string" },
        "dry-run": { type: "boolean" },
        json: { type: "boolean" },
        "tools-root": { type: "string" },
        help: { type: "boolean" },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (flags.help) {
    console.log(HELP);
    return 0;
  }

  let answers: Answers = flags;
  const missing = FIELDS.filter((field) => flags[field] === undefined);
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true && !flags.json;
  if (missing.length > 0) {
    if (!interactive) {
      const message = `Missing ${missing.map((field) => `--${field}`).join(", ")}. Give every input as a flag, or run this in a terminal to be asked.\nExample: ${exampleCommand(missing)}`;
      console.error(flags.json ? JSON.stringify({ ok: false, problems: [message] }) : message);
      return 2;
    }
    try {
      answers = await askForMissing(flags, missing, {
        input: process.stdin,
        output: process.stdout,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 2;
    }
  }

  const input = toInput(answers);
  const toolsRoot = flags["tools-root"] ?? defaultToolsRoot;

  let cleanup = () => {};
  const onSignal = () => {
    cleanup();
    console.error("\nCancelled. Nothing was left behind.");
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    const result = await generateTool(input, {
      toolsRoot,
      dryRun: flags["dry-run"] === true,
      registerCleanup: (fn) => {
        cleanup = fn;
      },
    });
    if (flags.json) {
      const { path: _path, ...shown } = result;
      console.log(
        JSON.stringify({ ok: true, ...shown, nextSteps: nextSteps(result, input.id) }, null, 2),
      );
    } else if (result.dryRun) {
      console.log(
        `Dry run: ${result.dir}/ passes every check and would get:\n${result.files.map((file) => `  ${file}`).join("\n")}\nNothing was written.`,
      );
    } else {
      console.log(nextSteps(result, input.id).join("\n"));
    }
    return 0;
  } catch (error) {
    if (error instanceof GeneratorError) {
      if (flags.json) {
        console.log(JSON.stringify({ ok: false, problems: error.problems }, null, 2));
      } else {
        console.error(
          `Nothing was created. ${error.problems.length === 1 ? "One problem" : `${error.problems.length} problems`} to fix:\n\n${error.problems.map((problem) => `  • ${problem}`).join("\n")}`,
        );
      }
      return 1;
    }
    console.error(
      `Nothing was left behind (${stagingDirFor(toolsRoot, input.id)} was removed).\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    return 1;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

process.exitCode = await main();
