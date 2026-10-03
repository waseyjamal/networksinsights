// Pure logic of Remove Duplicate Lines. The text is split at each line break (LF or CRLF); a final
// line break does not start another line. Two lines are duplicates when they match exactly, or after
// lower-casing and trimming when those options are on. One pass with a Set, so a 1 MB text takes
// milliseconds. The result is joined with LF.

export type Keep = "first" | "last";
export const KEEPS = ["first", "last"] as const satisfies readonly Keep[];
export type Sort = "none" | "asc" | "desc";
export const SORTS = ["none", "asc", "desc"] as const satisfies readonly Sort[];

/** The longest text the tool takes, in characters. */
export const MAX_CHARS = 1_000_000;

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  text: string;
  ignoreCase: boolean;
  /** Removes spaces and tabs at both ends of each line, in the result too. */
  trim: boolean;
  removeEmpty: boolean;
  keep: Keep;
  sort: Sort;
}

export type Result =
  | { ok: true; output: string; before: number; after: number; removed: number }
  | { ok: false; error: string };

const collator = new Intl.Collator("en");

/** The text without its repeated lines, and how many lines went, or why it was refused. */
export function run(input: Input): Result {
  if (input.text.length > MAX_CHARS) {
    return {
      ok: false,
      error: `The text is too long: ${input.text.length.toLocaleString("en-US")} characters, and the limit is ${MAX_CHARS.toLocaleString("en-US")}.`,
    };
  }
  if (input.text === "") return { ok: true, output: "", before: 0, after: 0, removed: 0 };

  const lines = input.text.split(/\r?\n/);
  if (lines[lines.length - 1] === "" && lines.length > 1) lines.pop();
  const before = lines.length;

  let kept: string[] = [];
  const seen = new Set<string>();
  const order = input.keep === "first" ? lines : [...lines].reverse();
  for (const raw of order) {
    const line = input.trim ? raw.replace(/^[ \t]+|[ \t]+$/g, "") : raw;
    if (input.removeEmpty && line === "") continue;
    const key = input.ignoreCase ? line.toLowerCase() : line;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }
  if (input.keep === "last") kept.reverse();
  if (input.sort !== "none") {
    kept = kept.sort(collator.compare);
    if (input.sort === "desc") kept.reverse();
  }
  return {
    ok: true,
    output: kept.join("\n"),
    before,
    after: kept.length,
    removed: before - kept.length,
  };
}
