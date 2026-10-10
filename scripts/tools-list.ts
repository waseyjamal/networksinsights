// pnpm tools:list [--check]
//
// Writes docs/tools-list.md from the tool folders. `--check` writes nothing and exits 1 when the
// file is out of date. Exit code 2 means the command was used wrongly.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { defaultToolsRoot, loadTools, repoRoot, siteConfig } from "./lib/tools";
import { renderToolsList, type ToolRow } from "./lib/tools-list";

const HELP = `Usage: pnpm tools:list [--check]

Writes docs/tools-list.md: id, name, category, runtime and summary of every tool.

  --check   do not write; exit 1 if docs/tools-list.md is out of date
  --help    show this text`;

async function main(): Promise<number> {
  let values: { check?: boolean | undefined; help?: boolean | undefined };
  try {
    ({ values } = parseArgs({
      options: { check: { type: "boolean" }, help: { type: "boolean" } },
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

  const loaded = await loadTools(defaultToolsRoot);
  const rows: ToolRow[] = [];
  for (const tool of loaded) {
    const m = tool.entry.manifest as Partial<Record<keyof ToolRow, unknown>> | undefined;
    if (!m || tool.problems.length > 0) {
      console.error(`${tool.entry.dir}: manifest could not be read. Run pnpm check:tools.`);
      return 1;
    }
    rows.push({
      id: String(m.id),
      name: String(m.name),
      category: String(m.category),
      runtime: String(m.runtime),
      summary: String(m.summary),
    });
  }
  const names = new Map(siteConfig.categories.map((c) => [c.id, c.name] as const));
  const text = renderToolsList(rows, names);
  const file = join(repoRoot, "docs", "tools-list.md");

  if (values.check) {
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (current === text) {
      console.log(`docs/tools-list.md is up to date (${rows.length} tools).`);
      return 0;
    }
    console.error("docs/tools-list.md is out of date. Run: pnpm tools:list");
    return 1;
  }
  writeFileSync(file, text, "utf8");
  console.log(`Wrote docs/tools-list.md (${rows.length} tools).`);
  return 0;
}

process.exit(await main());
