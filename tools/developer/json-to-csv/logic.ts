// Pure logic of JSON to CSV Converter. The JSON is an array of objects (one row each) or one object
// (one row). Columns are every key, in the order first seen. Fields are written per RFC 4180: a
// field holding the delimiter, a double quote, a carriage return or a line feed is put in double
// quotes, a quote inside is doubled, and records end with CRLF.

export type Delimiter = "comma" | "semicolon" | "tab";
export const DELIMITERS = ["comma", "semicolon", "tab"] as const satisfies readonly Delimiter[];
export const DELIMITER_CHARS: Readonly<Record<Delimiter, string>> = {
  comma: ",",
  semicolon: ";",
  tab: "\t",
};

/** The longest JSON text the tool takes, in characters. */
export const MAX_CHARS = 1_000_000;

/** The characters a formula can start with in a spreadsheet. */
export const FORMULA_START = /^[=+\-@\t\r]/;

export interface Options {
  delimiter: Delimiter;
  header: boolean;
  flatten: boolean;
  quoteAll: boolean;
  /** Puts one space before a text cell that starts with =, +, -, @, a tab or a carriage return. */
  protect: boolean;
}

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input extends Options {
  text: string;
}

export type Result =
  | { ok: true; csv: string; rows: number; columns: number }
  | { ok: false; error: string };

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isObject = (value: Json): value is { [key: string]: Json } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One row as a map of column name to value; nested objects become "a.b" when flattening. */
function flattenRow(row: { [key: string]: Json }, flatten: boolean): Map<string, Json> {
  const out = new Map<string, Json>();
  const walk = (value: { [key: string]: Json }, prefix: string) => {
    for (const [key, item] of Object.entries(value)) {
      const name = prefix === "" ? key : `${prefix}.${key}`;
      if (flatten && isObject(item) && Object.keys(item).length > 0) walk(item, name);
      else out.set(name, item);
    }
  };
  walk(row, "");
  return out;
}

/** A value as cell text: null and missing are empty, arrays and objects are JSON text. */
export function cellText(value: Json | undefined): string {
  if (typeof value === "undefined" || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** One field, protected and quoted as the options say. */
export function field(text: string, isText: boolean, options: Options): string {
  const delimiter = DELIMITER_CHARS[options.delimiter];
  const safe = options.protect && isText && FORMULA_START.test(text) ? ` ${text}` : text;
  const needsQuotes = options.quoteAll || safe.includes(delimiter) || /["\r\n]/.test(safe);
  return needsQuotes ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** The JSON turned into CSV, or what is wrong with it. */
export function run(input: Input): Result {
  if (input.text.trim() === "") return { ok: false, error: "Paste JSON or choose a file." };
  if (input.text.length > MAX_CHARS) {
    return {
      ok: false,
      error: `The JSON is too long: ${input.text.length.toLocaleString("en-US")} characters, and the limit is ${MAX_CHARS.toLocaleString("en-US")}.`,
    };
  }
  let data: Json;
  try {
    data = JSON.parse(input.text) as Json;
  } catch (error) {
    return {
      ok: false,
      error: `This is not valid JSON: ${error instanceof Error ? error.message : "it could not be read"}.`,
    };
  }
  const list = Array.isArray(data) ? data : [data];
  if (list.length === 0) return { ok: false, error: "The array is empty, so there are no rows." };
  const index = list.findIndex((item) => !isObject(item));
  if (index !== -1) {
    return {
      ok: false,
      error: Array.isArray(data)
        ? `Item ${index + 1} of the array is not an object. Each item must be an object such as {"name": "Asha"}.`
        : 'The JSON must be an array of objects, or one object such as {"name": "Asha"}.',
    };
  }

  const rows = (list as { [key: string]: Json }[]).map((row) => flattenRow(row, input.flatten));
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of row.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  if (columns.length === 0)
    return { ok: false, error: "The objects have no keys, so there are no columns." };

  const delimiter = DELIMITER_CHARS[input.delimiter];
  const lines: string[] = [];
  if (input.header) lines.push(columns.map((name) => field(name, true, input)).join(delimiter));
  for (const row of rows) {
    lines.push(
      columns
        .map((name) => {
          const value = row.get(name);
          return field(cellText(value), typeof value === "string", input);
        })
        .join(delimiter),
    );
  }
  return { ok: true, csv: `${lines.join("\r\n")}\r\n`, rows: rows.length, columns: columns.length };
}
