// pnpm check:tools [--tool <id>] [--json]
//
// Runs every tool-specific gate on its own and prints a readable summary. Exit code 0 means every
// gate passes; 1 means something needs fixing; 2 means the command was used wrongly.

import { parseArgs } from "node:util";
import { CheckUsageError, checkTools, formatReport, reportToJson } from "./lib/check";

const HELP = `Usage: pnpm check:tools [--tool <id>] [--json]

Runs every tool gate: the contract, the purity of logic.ts and the content quality gates.

  --tool <id>   check one tool (its folder name) and report only on it. Fast when there are many.
  --json        print the result as JSON, for an agent or a script
  --tools-root <path>  check another folder than tools/ (used by the tests)
  --help        show this text

Example: pnpm check:tools --tool word-counter`;

async function main(): Promise<number> {
  let values: {
    tool?: string | undefined;
    json?: boolean | undefined;
    help?: boolean | undefined;
    "tools-root"?: string | undefined;
  };
  try {
    ({ values } = parseArgs({
      options: {
        tool: { type: "string" },
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
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  try {
    const report = await checkTools({
      ...(values.tool === undefined ? {} : { tool: values.tool }),
      ...(values["tools-root"] === undefined ? {} : { root: values["tools-root"] }),
    });
    console.log(values.json ? reportToJson(report) : formatReport(report));
    return report.ok ? 0 : 1;
  } catch (error) {
    if (error instanceof CheckUsageError) {
      console.error(
        values.json ? JSON.stringify({ ok: false, error: error.message }) : error.message,
      );
      return 2;
    }
    throw error;
  }
}

process.exitCode = await main();
