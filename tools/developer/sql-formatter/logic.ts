// Pure logic of "SQL Formatter": the limits, the dialects and choices, and how a parse error
// becomes a line, a column and a pointer. No DOM, no network, no top-level statements
// (docs/tool-contract.md, "logic.ts: what pure means"). formatSql() is handed the `sql-formatter`
// library by worker.ts, which loads it only when the worker starts (ADR 0062); logic.ts imports
// nothing, and the tests hand it the same library.

export const LIMITS = {
  /** The longest text accepted, in characters. A phone takes several seconds near it. */
  maxCharacters: 200_000,
} as const;

/**
 * Every dialect sql-formatter 15.9.0 supports, with the name the page shows. The library's `tsql`
 * is another key for `transactsql`, so it is offered once. A test keeps this list in step with
 * the library's own.
 */
export const DIALECTS = {
  sql: "Standard SQL",
  bigquery: "Google BigQuery",
  clickhouse: "ClickHouse",
  db2: "IBM Db2",
  db2i: "IBM Db2 for i",
  duckdb: "DuckDB",
  hive: "Apache Hive",
  mariadb: "MariaDB",
  mysql: "MySQL",
  n1ql: "Couchbase N1QL",
  plsql: "Oracle PL/SQL",
  postgresql: "PostgreSQL",
  redshift: "Amazon Redshift",
  singlestoredb: "SingleStoreDB",
  snowflake: "Snowflake",
  spark: "Spark SQL",
  sqlite: "SQLite",
  tidb: "TiDB",
  transactsql: "SQL Server (Transact-SQL)",
  trino: "Trino and Presto",
} as const;

export type Dialect = keyof typeof DIALECTS;

export const DIALECT_KEYS = Object.keys(DIALECTS) as Dialect[];

export const CASES = ["preserve", "upper", "lower"] as const;

export type Case = (typeof CASES)[number];

export const CASE_LABELS: Readonly<Record<Case, string>> = {
  preserve: "As written",
  upper: "UPPER CASE",
  lower: "lower case",
};

export const INDENTS = ["2", "4", "tab"] as const;

export type Indent = (typeof INDENTS)[number];

export const INDENT_LABELS: Readonly<Record<Indent, string>> = {
  "2": "2 spaces",
  "4": "4 spaces",
  tab: "Tabs",
};

export interface Input {
  text: string;
  dialect: Dialect;
  keywordCase: Case;
  indent: Indent;
}

/** What worker.ts sends back. An error without an offset is one with no position in it. */
export type WorkerResult =
  | { ok: true; output: string }
  | { ok: false; message: string; offset: number | null };

/** Where the SQL could not be read. `line` and `column` count from 1. */
export interface Location {
  line: number;
  column: number;
  /** The line of the error, cut to about 80 characters around it, and a caret under the spot. */
  pointer: string;
}

export type Result =
  | { ok: true; output: string; lines: number; characters: number }
  | { ok: false; reason: "empty" | "tooLong" | "failed"; error: string }
  | { ok: false; reason: "invalid"; error: string; at: Location };

export const MESSAGES = {
  empty: "Paste or type SQL to format it.",
  tooLong: (limit: string) =>
    `This text is longer than ${limit} characters. Split it into smaller parts.`,
  unreadable: (dialect: string) =>
    `This SQL could not be read as ${dialect}. Check that every quote and bracket is closed, or pick the dialect your database uses.`,
  failed: "The SQL could not be formatted. Try again.",
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

/** The parts of the `sql-formatter` library formatSql() uses, described by shape. */
export interface SqlFormatterLibrary {
  format(query: string, options: object): string;
}

/**
 * The character offset of a line and column as sql-formatter reports them ("at line 2 column 7",
 * both from 1), or null when the message has none.
 */
export function offsetOf(text: string, message: string): number | null {
  const match = /at line (\d+) column (\d+)/.exec(message);
  if (!match) return null;
  const line = Number(match[1]);
  const column = Number(match[2]);
  let start = 0;
  for (let current = 1; current < line; current++) {
    const next = text.indexOf("\n", start);
    if (next === -1) return null;
    start = next + 1;
  }
  return Math.min(start + column - 1, text.length);
}

/**
 * Formats the SQL for its dialect: one clause a line, the chosen indentation, and keywords, data
 * types and function names in the chosen case. Identifiers, strings and comments keep their
 * spelling. Statements are separated by one blank line.
 */
export function formatSql(library: SqlFormatterLibrary, input: Input): WorkerResult {
  const textCase = input.keywordCase;
  try {
    const output = library.format(input.text, {
      language: input.dialect,
      keywordCase: textCase,
      dataTypeCase: textCase,
      functionCase: textCase,
      tabWidth: input.indent === "tab" ? 2 : Number(input.indent),
      useTabs: input.indent === "tab",
      linesBetweenQueries: 1,
    });
    return { ok: true, output: output.endsWith("\n") ? output : `${output}\n` };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    const offset = offsetOf(input.text, message);
    if (offset === null) return { ok: false, message: MESSAGES.failed, offset: null };
    return { ok: false, message: MESSAGES.unreadable(DIALECTS[input.dialect]), offset };
  }
}

/** The worker's answer as the page shows it. */
export function finish(text: string, result: WorkerResult): Result {
  if (result.ok) return { ...result, ...measure(result.output) };
  if (result.offset === null) return { ok: false, reason: "failed", error: result.message };
  const at = locate(text, result.offset);
  return {
    ok: false,
    reason: "invalid",
    error: `Line ${at.line}, column ${at.column}: ${result.message}`,
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
