// Pure logic of "Regex Tester": no DOM, no network, no top-level statements, and imports only
// from zod, the SDK or this folder (docs/tool-contract.md, "logic.ts: what pure means").
//
// It runs the visitor's pattern with the JavaScript RegExp of the device it is on, so it tests
// exactly what JavaScript code on that engine would match. It never rewrites the pattern.

/** The most characters of pattern the tool reads. */
export const MAX_PATTERN_CHARS = 5_000;

/** The most characters of test string the tool reads. */
export const MAX_TEXT_CHARS = 500_000;

/** The most matches the tool collects. It stops there and says so, so a page of results stays light. */
export const MAX_MATCHES = 1_000;

/** The flags the tool takes, in the order the page names them. */
export const SUPPORTED_FLAGS: readonly string[] = ["g", "i", "m", "s", "u"];

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  /** The pattern, without the surrounding slashes. */
  pattern: string;
  /** Any of g, i, m, s and u, each at most once. */
  flags: string;
  text: string;
}

/** One capture group of a match. */
export interface Group {
  /** The group's number in the pattern, counting from 1 by opening parenthesis. */
  number: number;
  /** The name of a named group, or null. */
  name: string | null;
  /** What it captured, or null when the group took no part in this match. */
  value: string | null;
}

export interface Match {
  /** Where the match starts in the test string, counting UTF-16 code units from 0. */
  index: number;
  /** Where it ends: `index` plus the length of `text`. */
  end: number;
  text: string;
  groups: Group[];
}

/** One run of the test string: plain text, or a match (`match` is its position in `matches`). */
export interface Segment {
  text: string;
  match?: number;
}

export interface Matched {
  ok: true;
  matches: Match[];
  /** True when more matches exist than the tool collects (`MAX_MATCHES`). */
  truncated: boolean;
  /** True when the g flag is on. Without it JavaScript finds the first match only. */
  global: boolean;
  /** How many of `matches` are empty, and so cannot be highlighted. */
  empty: number;
  /** The test string cut into plain runs and matches, in order, for highlighting. */
  segments: Segment[];
}

export interface Failure {
  ok: false;
  reason: "empty" | "flags" | "pattern" | "too-large";
  error: string;
}

export type Result = Matched | Failure;

/** Tests a pattern against a string and collects the matches. */
export function run(input: Input): Result {
  const { pattern, text } = input;
  const flags = input.flags.trim();

  if (pattern.length > MAX_PATTERN_CHARS) {
    return fail(
      "too-large",
      `The pattern is ${pattern.length.toLocaleString("en-US")} characters, more than the ${MAX_PATTERN_CHARS.toLocaleString("en-US")} the tool reads.`,
    );
  }
  if (text.length > MAX_TEXT_CHARS) {
    return fail(
      "too-large",
      `The test string is ${text.length.toLocaleString("en-US")} characters, more than the ${MAX_TEXT_CHARS.toLocaleString("en-US")} the tool reads.`,
    );
  }
  const flagProblem = checkFlags(flags);
  if (flagProblem !== null) return fail("flags", flagProblem);
  if (pattern === "") return fail("empty", "Type a pattern to test it.");

  const global = flags.includes("g");
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, global ? flags : `${flags}g`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The engine refused it.";
    return fail("pattern", `This is not a valid regular expression. ${reason}`);
  }

  const names = groupNames(pattern);
  const unicode = flags.includes("u");
  const matches: Match[] = [];
  let truncated = false;
  for (;;) {
    const found = regex.exec(text);
    if (found === null) break;
    if (matches.length >= MAX_MATCHES) {
      truncated = true;
      break;
    }
    matches.push(toMatch(found, names));
    if (!global) break;
    // An empty match leaves lastIndex where it is, so step past it or the loop never ends.
    if (found[0] === "") regex.lastIndex = nextIndex(text, regex.lastIndex, unicode);
  }

  return {
    ok: true,
    matches,
    truncated,
    global,
    empty: matches.filter((match) => match.text === "").length,
    segments: segmentsOf(text, matches),
  };
}

/** Why a flags string is not usable, or null when it is. */
export function checkFlags(flags: string): string | null {
  const seen = new Set<string>();
  for (const flag of flags) {
    if (!SUPPORTED_FLAGS.includes(flag)) {
      return `The flag "${flag}" is not supported here. Use g, i, m, s or u.`;
    }
    if (seen.has(flag)) return `The flag "${flag}" is written twice. Each flag counts once.`;
    seen.add(flag);
  }
  return null;
}

/**
 * The name of every capture group of a pattern, in order: entry 0 is group 1. An unnamed group is
 * null. It reads the pattern the way the engine does: an escaped character and a `[...]` class
 * hold no group, and `(?:`, `(?=`, `(?!`, `(?<=` and `(?<!` are not capture groups.
 */
export function groupNames(pattern: string): Array<string | null> {
  const names: Array<string | null> = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "\\") {
      i++;
    } else if (inClass) {
      if (char === "]") inClass = false;
    } else if (char === "[") {
      inClass = true;
    } else if (char === "(") {
      if (pattern[i + 1] !== "?") {
        names.push(null);
      } else if (pattern[i + 2] === "<" && pattern[i + 3] !== "=" && pattern[i + 3] !== "!") {
        const end = pattern.indexOf(">", i + 3);
        names.push(end < 0 ? null : pattern.slice(i + 3, end));
      }
    }
  }
  return names;
}

/** Cuts `text` into plain runs and matches. Empty matches have nothing to highlight and are skipped. */
export function segmentsOf(text: string, matches: readonly Match[]): Segment[] {
  const segments: Segment[] = [];
  let position = 0;
  matches.forEach((match, number) => {
    if (match.text === "") return;
    if (match.index > position) segments.push({ text: text.slice(position, match.index) });
    segments.push({ text: match.text, match: number });
    position = match.end;
  });
  if (position < text.length) segments.push({ text: text.slice(position) });
  return segments;
}

function toMatch(found: RegExpExecArray, names: ReadonlyArray<string | null>): Match {
  const groups: Group[] = [];
  for (let number = 1; number < found.length; number++) {
    groups.push({ number, name: names[number - 1] ?? null, value: found[number] ?? null });
  }
  return { index: found.index, end: found.index + found[0].length, text: found[0], groups };
}

/** The index after `index`: one code point on, in unicode mode, so a pair is never split. */
function nextIndex(text: string, index: number, unicode: boolean): number {
  if (!unicode) return index + 1;
  return index + ((text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1);
}

function fail(reason: Failure["reason"], error: string): Failure {
  return { ok: false, reason, error };
}
