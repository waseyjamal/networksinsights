// Pure logic of CSV to JSON Parser: a reader for RFC 4180 CSV written for this tool, then the rows as
// JSON. Fields may be put in double quotes; inside them the delimiter, line breaks and doubled
// quotes ("") are kept. Records end with CRLF or LF. A byte order mark at the start is dropped,
// and lines with nothing on them are skipped.

export type Delimiter = "auto" | "comma" | "semicolon" | "tab";
export const DELIMITERS = [
  "auto",
  "comma",
  "semicolon",
  "tab",
] as const satisfies readonly Delimiter[];
const CHARS = { comma: ",", semicolon: ";", tab: "\t" } as const;
type Fixed = keyof typeof CHARS;
export const DELIMITER_NAMES: Readonly<Record<Fixed, string>> = {
  comma: "comma",
  semicolon: "semicolon",
  tab: "tab",
};

/** The longest CSV text the tool takes, in characters. */
export const MAX_CHARS = 1_000_000;

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  text: string;
  delimiter: Delimiter;
  header: boolean;
  /** Turns numbers and true/false into JSON numbers and booleans. */
  convert: boolean;
  pretty: boolean;
}

export type Result =
  | { ok: true; json: string; rows: number; columns: number; delimiter: Fixed }
  | { ok: false; error: string };

export interface Row {
  fields: string[];
  /** The line the record starts on, counting from 1. */
  line: number;
}

/**
 * The delimiter of the first record: whichever of comma, semicolon and tab appears most often in it
 * outside double quotes. A tie goes to the earlier in that order, and none at all means comma.
 */
export function detectDelimiter(text: string): Fixed {
  const counts: Record<Fixed, number> = { comma: 0, semicolon: 0, tab: 0 };
  let quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "\n") break;
    else if (!quoted && c === ",") counts.comma += 1;
    else if (!quoted && c === ";") counts.semicolon += 1;
    else if (!quoted && c === "\t") counts.tab += 1;
  }
  let best: Fixed = "comma";
  for (const name of ["semicolon", "tab"] as const) if (counts[name] > counts[best]) best = name;
  return best;
}

/** The records of a CSV text, or the first problem with the line it is on. */
export function parseCsv(text: string, delimiter: string): Row[] | { error: string } {
  const rows: Row[] = [];
  let fields: string[] = [];
  let field = "";
  let line = 1;
  let start = 1;
  let quoted = false;
  let quoteLine = 1;
  let closed = false;
  const end = () => {
    fields.push(field);
    if (!(fields.length === 1 && field === "" && !closed)) rows.push({ fields, line: start });
    fields = [];
    field = "";
    closed = false;
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        if (c === "\n") line += 1;
        field += c;
      }
    } else if (c === delimiter) {
      fields.push(field);
      field = "";
      closed = false;
    } else if (c === "\n" || (c === "\r" && text[i + 1] === "\n")) {
      if (c === "\r") i += 1;
      end();
      line += 1;
      start = line;
    } else if (c === '"') {
      if (field !== "" || closed) {
        return {
          error: `Line ${line}: a double quote is inside a field that does not start with one. Put the whole field in double quotes and write the quote twice ("").`,
        };
      }
      quoted = true;
      quoteLine = line;
    } else {
      if (closed) {
        return {
          error: `Line ${line}: there is text after the closing double quote of a field. Put a delimiter after the quote, or write the quote twice ("") inside the field.`,
        };
      }
      field += c;
    }
  }
  if (quoted)
    return { error: `Line ${quoteLine}: a quoted field starts here and is never closed.` };
  if (field !== "" || fields.length > 0 || closed) end();
  return rows;
}

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * A field as a JSON value. With `convert`, exactly "true" and "false" become booleans, and text in
 * JSON number form becomes a number when it survives the round trip unchanged in value (so
 * 9007199254740993 and 0123 stay text). Everything else stays text.
 */
export function value(field: string, convert: boolean): string | number | boolean {
  if (!convert) return field;
  if (field === "true") return true;
  if (field === "false") return false;
  if (NUMBER.test(field)) {
    const n = Number(field);
    if (Number.isFinite(n) && (!/^-?\d+$/.test(field) || Number.isSafeInteger(n))) return n;
  }
  return field;
}

/** The CSV turned into JSON, or what is wrong with it. */
export function run(input: Input): Result {
  const text = input.text.startsWith("﻿") ? input.text.slice(1) : input.text;
  if (text.trim() === "") return { ok: false, error: "Paste CSV or choose a file." };
  if (input.text.length > MAX_CHARS) {
    return {
      ok: false,
      error: `The CSV is too long: ${input.text.length.toLocaleString("en-US")} characters, and the limit is ${MAX_CHARS.toLocaleString("en-US")}.`,
    };
  }
  const delimiter = input.delimiter === "auto" ? detectDelimiter(text) : input.delimiter;
  const parsed = parseCsv(text, CHARS[delimiter]);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  if (parsed.length === 0) return { ok: false, error: "The CSV has no rows." };

  const width = (parsed[0] as Row).fields.length;
  const bad = parsed.find((row) => row.fields.length !== width);
  if (bad) {
    return {
      ok: false,
      error: `Line ${bad.line}: this row has ${bad.fields.length} fields, but the first row has ${width}. Check for a missing or extra ${DELIMITER_NAMES[delimiter]}, or a field that needs double quotes.`,
    };
  }

  const space = input.pretty ? 2 : 0;
  if (!input.header) {
    const data = parsed.map((row) => row.fields.map((field) => value(field, input.convert)));
    return {
      ok: true,
      json: JSON.stringify(data, null, space),
      rows: data.length,
      columns: width,
      delimiter,
    };
  }
  const names: string[] = [];
  const used = new Set<string>();
  for (const [index, raw] of (parsed[0] as Row).fields.entries()) {
    const base = raw.trim() === "" ? `column${index + 1}` : raw;
    let name = base;
    for (let n = 2; used.has(name); n += 1) name = `${base}_${n}`;
    used.add(name);
    names.push(name);
  }
  // fromEntries defines each key as its own property, so a column named "__proto__" stays a column.
  const data = parsed
    .slice(1)
    .map((row) =>
      Object.fromEntries(
        names.map((name, index) => [name, value(row.fields[index] as string, input.convert)]),
      ),
    );
  return {
    ok: true,
    json: JSON.stringify(data, null, space),
    rows: data.length,
    columns: width,
    delimiter,
  };
}
