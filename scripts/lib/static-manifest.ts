// Reads a tool's manifest fields out of tool.config.ts without running it.
//
// `pnpm check:tools --tool <id>` has to stay fast with hundreds of tools. Importing a
// tool.config.ts costs a TypeScript transform and a module load, about 15 ms each, and parsing one
// with the TypeScript compiler about 4 ms. The tools that are not being checked only matter for
// their id, name and summary: the gates that compare across tools (unique names and summaries,
// near-duplicate content, related links) read nothing else. So the tool being checked is imported,
// and the others are read as text, at a few hundredths of a millisecond each.
//
// The reading is deliberately narrow. Biome formats every tool.config.ts (`pnpm lint`), so the
// manifest's own properties sit at two spaces of indentation and their strings use double quotes.
// A line shaped like that is read; anything else (a constant, a spread, a template with a hole, a
// missing field) returns undefined, and the caller imports the file instead, so a tool is never
// misread. scripts/static-manifest.test.ts checks this reader against a real import.

import { z } from "zod";

/** `  name: "Word counter",` or `  summary:\n    "A long summary...",`, at two spaces. */
const STRING_PROPERTY =
  /^ {2}(id|name|category|summary|runtime|status|added|updated):\s*("(?:[^"\\\n]|\\.)*"),?$/gm;

/** `  tags: ["a", "b"],`, on one line or many. */
const LIST_PROPERTY = /^ {2}(tags|related): \[([^\]]*)\],?$/gm;

const STRING_IN_LIST = /"((?:[^"\\\n]|\\.)*)"/g;

/**
 * The manifest fields of a tool.config.ts, read as text, with a placeholder `input`. Undefined when
 * the file is not in the plain shape, or when id, name, category or summary is missing.
 */
export function readManifestFields(source: string): Record<string, unknown> | undefined {
  const fields: Record<string, unknown> = {};

  for (const match of source.matchAll(STRING_PROPERTY)) {
    // The same property twice means one of them is not the manifest's own.
    if ((match[1] as string) in fields) return undefined;
    try {
      fields[match[1] as string] = JSON.parse(match[2] as string) as string;
    } catch {
      return undefined;
    }
  }
  for (const match of source.matchAll(LIST_PROPERTY)) {
    const items = [...(match[2] as string).matchAll(STRING_IN_LIST)].map(
      (item) => JSON.parse(`"${item[1]}"`) as string,
    );
    if ((match[1] as string) in fields) return undefined;
    fields[match[1] as string] = items;
  }

  for (const required of ["id", "name", "category", "summary"]) {
    if (typeof fields[required] !== "string") return undefined;
  }
  if (!/export default (?:defineTool\()?\{/.test(source)) return undefined;
  return { ...fields, input: z.object({}) };
}
