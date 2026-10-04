// Pure logic of "YAML Formatter": the limits, the choices, the checks made before any parsing, and
// how a parser error becomes a line, a column and a pointer. No DOM, no network, no top-level
// statements (docs/tool-contract.md, "logic.ts: what pure means"). formatYaml() is handed the
// `yaml` library by worker.ts, which loads it only when the worker starts (ADR 0062); logic.ts
// imports nothing, and the tests hand it the same library.

export const LIMITS = {
  /** The longest text accepted, in characters. A phone takes several seconds near it. */
  maxCharacters: 500_000,
} as const;

export const MODES = ["format", "minify"] as const;

export type Mode = (typeof MODES)[number];

export const MODE_LABELS: Readonly<Record<Mode, string>> = {
  format: "Format",
  minify: "Minify",
};

/** YAML forbids tabs for indentation, so only spaces are offered. */
export const INDENTS = ["2", "4"] as const;

export type Indent = (typeof INDENTS)[number];

export const INDENT_LABELS: Readonly<Record<Indent, string>> = {
  "2": "2 spaces",
  "4": "4 spaces",
};

export interface Input {
  text: string;
  mode: Mode;
  indent: Indent;
}

/** What worker.ts sends back: the printed YAML, or the first error with its character offset. */
export type WorkerResult =
  | { ok: true; output: string; documents: number }
  | { ok: false; message: string; offset: number; more: number };

/** Where the YAML went wrong. `line` and `column` count from 1. */
export interface Location {
  line: number;
  column: number;
  /** The line of the error, cut to about 80 characters around it, and a caret under the spot. */
  pointer: string;
}

export type Result =
  | { ok: true; output: string; documents: number; lines: number; characters: number }
  | { ok: false; reason: "empty" | "tooLong" | "failed"; error: string }
  | { ok: false; reason: "invalid"; error: string; at: Location };

export const MESSAGES = {
  empty: "Paste or type YAML to format it.",
  onlyComments: "There is no YAML here to format, only comments or blank lines.",
  tooLong: (limit: string) =>
    `This text is longer than ${limit} characters. Split it into smaller parts.`,
  more: (count: number) =>
    count === 1
      ? "There is 1 more error after this one."
      : `There are ${count} more errors after this one.`,
  failed: "The YAML could not be formatted. Try again.",
} as const;

const number = (value: number) => value.toLocaleString("en-US");

/** The problems found without parsing: no text, or too much of it. */
export function precheck(text: string): Result | null {
  if (text.trim() === "") return { ok: false, reason: "empty", error: MESSAGES.empty };
  if (text.length > LIMITS.maxCharacters) {
    return { ok: false, reason: "tooLong", error: MESSAGES.tooLong(number(LIMITS.maxCharacters)) };
  }
  return null;
}

/**
 * The yaml library ends its messages with " at line 3, column 1:" and a code excerpt. The page
 * shows its own line, column and pointer, so only the sentence is kept, ending with a full stop.
 */
export function cleanMessage(message: string): string {
  const first = (message.split("\n")[0] ?? "").replace(/ at line \d+, column \d+:?\s*$/, "").trim();
  if (first === "") return "This is not valid YAML.";
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

/** The worker's answer as the page shows it. */
export function finish(text: string, result: WorkerResult): Result {
  if (result.ok) {
    if (result.documents === 0) return { ok: false, reason: "empty", error: MESSAGES.onlyComments };
    return {
      ok: true,
      output: result.output,
      documents: result.documents,
      ...measure(result.output),
    };
  }
  const at = locate(text, result.offset);
  const more = result.more > 0 ? ` ${MESSAGES.more(result.more)}` : "";
  return {
    ok: false,
    reason: "invalid",
    error: `Line ${at.line}, column ${at.column}: ${cleanMessage(result.message)}${more}`,
    at,
  };
}

/** Lines and characters of a result. A final line break does not start another line. */
export function measure(text: string): { lines: number; characters: number } {
  if (text === "") return { lines: 0, characters: 0 };
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return { lines: body.split("\n").length, characters: [...text].length };
}

/** How much of a long line the pointer shows on each side of the error. */
const POINTER_REACH = 40;

/** The line, column and pointer of a character offset. The column counts code points. */
export function locate(text: string, offset: number): Location {
  const at = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < at; i++) {
    if (text.charCodeAt(i) === 0x0a) {
      line++;
      lineStart = i + 1;
    }
  }
  let lineEnd = at;
  while (lineEnd < text.length && text[lineEnd] !== "\n" && text[lineEnd] !== "\r") lineEnd++;
  const column = [...text.slice(lineStart, at)].length + 1;
  const from = Math.max(lineStart, at - POINTER_REACH);
  const to = Math.min(lineEnd, at + POINTER_REACH);
  const head = from > lineStart ? "…" : "";
  const tail = to < lineEnd ? "…" : "";
  // Tabs and control characters become spaces, so the caret lines up under the spot.
  const flat = (part: string) =>
    [...part].map((character) => (character.charCodeAt(0) < 0x20 ? " " : character)).join("");
  const caret = " ".repeat(head.length + [...text.slice(from, at)].length);
  return { line, column, pointer: `${head}${flat(text.slice(from, to))}${tail}\n${caret}^` };
}

/** The parts of the `yaml` library formatYaml() uses, described by shape. */
export interface YamlLibrary {
  parseAllDocuments(text: string, options: object): unknown;
  visit(node: never, visitor: (key: unknown, node: unknown) => void): void;
  isNode(value: unknown): boolean;
}

interface YamlNode {
  comment?: string | null;
  commentBefore?: string | null;
  spaceBefore?: boolean;
}

interface YamlDocument {
  errors: readonly { message: string; pos: readonly [number, number] }[];
  comment: string | null;
  commentBefore: string | null;
  toString(options: object): string;
}

/**
 * Parses every document in the text and prints it again: Format in block style with the chosen
 * indentation, Minify in flow style on one line a document, without comments. The failsafe schema
 * reads every scalar as the text it is written as, so nothing is converted and back: 007, 0x1F,
 * 1e5 and a 20-digit number are printed exactly as typed, quotes and block scalars keep their
 * style, and anchors, aliases and tags are kept. Duplicate keys are still errors.
 */
export function formatYaml(yaml: YamlLibrary, input: Input): WorkerResult {
  const parsed = yaml.parseAllDocuments(input.text, { schema: "failsafe", prettyErrors: false });
  // A text with no document (only comments or blank lines) parses to an empty stream, not a list.
  if (!Array.isArray(parsed)) return { ok: true, output: "", documents: 0 };
  const documents = parsed as YamlDocument[];
  const errors = documents.flatMap((document) => document.errors);
  const first = errors[0];
  if (first) {
    return { ok: false, message: first.message, offset: first.pos[0], more: errors.length - 1 };
  }
  const minify = input.mode === "minify";
  const parts = documents.map((document, index) => {
    if (minify) {
      document.commentBefore = null;
      document.comment = null;
      yaml.visit(document as never, (_key, node) => {
        if (!yaml.isNode(node)) return;
        const item = node as YamlNode;
        item.commentBefore = null;
        item.comment = null;
        item.spaceBefore = false;
      });
    }
    const printed = document.toString({
      indent: Number(input.indent),
      lineWidth: 0,
      collectionStyle: minify ? "flow" : "block",
      flowCollectionPadding: !minify,
    });
    // Every document after the first starts with "---", whether or not the input had one.
    return index > 0 && !printed.startsWith("---") ? `---\n${printed}` : printed;
  });
  return { ok: true, output: parts.join(""), documents: documents.length };
}
