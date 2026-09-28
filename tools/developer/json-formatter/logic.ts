// Pure logic of "JSON Formatter": no DOM, no network, no top-level statements, and imports only
// from zod, the SDK or this folder (docs/tool-contract.md, "logic.ts: what pure means").
//
// A validating JSON reader written from RFC 8259, in one pass and without recursion. It does not
// call JSON.parse: every string and number is copied exactly as it was written, so a 20-digit ID
// keeps its digits, 1.50 stays 1.50, escapes stay escapes, and duplicate keys stay in place. Only
// the whitespace between tokens changes. It also knows where it stopped, so an error has a line
// and a column in every browser, where JSON.parse messages differ from engine to engine. The work
// runs in steps (formatInSteps), so a long text never holds the page for long.

/** The two things the tool does, in the order the workspace shows them. */
export const MODES = ["format", "minify"] as const;

export type Mode = (typeof MODES)[number];

export const MODE_LABELS: Readonly<Record<Mode, string>> = {
  format: "Format",
  minify: "Minify",
};

/** The indentation choices for Format. */
export const INDENTS = ["2", "4", "tab"] as const;

export type Indent = (typeof INDENTS)[number];

export const INDENT_LABELS: Readonly<Record<Indent, string>> = {
  "2": "2 spaces",
  "4": "4 spaces",
  tab: "Tab",
};

/** How many characters of input one step reads before it pauses. */
export const STEP_SIZE = 65_536;

/** How deep objects and arrays may nest. Real JSON stays far below it. */
export const MAX_DEPTH = 1000;

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  text: string;
  mode: Mode;
  indent: Indent;
}

/** Where the JSON went wrong. `line` and `column` count from 1; the column counts characters. */
export interface JsonError {
  message: string;
  line: number;
  column: number;
  /** The line of the error, cut to about 80 characters around it, and a caret under the spot. */
  pointer: string;
}

/** What the tool gives back. */
export type Result =
  | { ok: true; output: string; lines: number; characters: number }
  | { ok: false; reason: "empty"; error: string }
  | { ok: false; reason: "invalid"; error: string; at: JsonError };

interface Failure {
  at: number;
  message: string;
}

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const SPACE = 0x20;
const QUOTE = 0x22;
const DOLLAR = 0x24;
const APOSTROPHE = 0x27;
const PLUS = 0x2b;
const COMMA = 0x2c;
const MINUS = 0x2d;
const DOT = 0x2e;
const SLASH = 0x2f;
const ZERO = 0x30;
const NINE = 0x39;
const COLON = 0x3a;
const OPEN_BRACKET = 0x5b;
const BACKSLASH = 0x5c;
const CLOSE_BRACKET = 0x5d;
const UNDERSCORE = 0x5f;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const BYTE_ORDER_MARK = 0xfeff;

/** The letters that may follow a backslash in a string: " \ / b f n r t u. */
const ESCAPES = '"\\/bfnrtu';

/** How much of a long line the error pointer shows on each side of the error. */
const POINTER_REACH = 40;

/**
 * Formats or minifies `input.text`, pausing (yielding) after about `stepSize` characters of
 * input, and returns the result when it is done. `run` drains it in one go.
 */
export function* formatInSteps(input: Input, stepSize = STEP_SIZE): Generator<void, Result, void> {
  const { text } = input;
  const end = text.length;
  const pretty = input.mode === "format";
  const unit = input.indent === "tab" ? "\t" : " ".repeat(Number(input.indent));
  // A line break plus the indentation of each depth, made once per depth.
  const breaks = ["\n"];
  const lineBreak = (depth: number) => {
    while (breaks.length <= depth) breaks.push(`${breaks[breaks.length - 1]}${unit}`);
    return breaks[depth] as string;
  };
  const invalid = (failure: Failure): Result => {
    const at = locate(text, failure);
    return {
      ok: false,
      reason: "invalid",
      error: `Line ${at.line}, column ${at.column}: ${at.message}`,
      at,
    };
  };

  const out: string[] = [];
  // The open containers, innermost last: OPEN_BRACE or OPEN_BRACKET.
  const stack: number[] = [];
  let i = skipSpace(text, text.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0);
  if (i >= end) return { ok: false, reason: "empty", error: "Paste or type JSON to begin." };

  let wantValue = true;
  let afterComma = false;
  let nextPause = stepSize;
  for (;;) {
    if (i >= nextPause) {
      yield;
      nextPause = i + stepSize;
    }

    if (wantValue) {
      i = skipSpace(text, i);
      const code = text.charCodeAt(i);
      if (code === OPEN_BRACE || code === OPEN_BRACKET) {
        const close = code === OPEN_BRACE ? CLOSE_BRACE : CLOSE_BRACKET;
        const inside = skipSpace(text, i + 1);
        if (text.charCodeAt(inside) === close) {
          out.push(code === OPEN_BRACE ? "{}" : "[]");
          i = inside + 1;
          wantValue = false;
          continue;
        }
        if (stack.length >= MAX_DEPTH) {
          return invalid({
            at: i,
            message: `Objects and arrays are nested more than ${MAX_DEPTH} levels deep here.`,
          });
        }
        stack.push(code);
        out.push(code === OPEN_BRACE ? "{" : "[");
        if (pretty) out.push(lineBreak(stack.length));
        i = inside;
        if (code === OPEN_BRACE) {
          const next = readName(text, inside, out, pretty, false);
          if (typeof next !== "number") return invalid(next);
          i = next;
        }
        afterComma = false;
        continue;
      }
      const next = readScalar(text, i, afterComma);
      if (typeof next !== "number") return invalid(next);
      out.push(text.slice(i, next));
      i = next;
      wantValue = false;
      continue;
    }

    // After a value: a comma, the end of the open container, or the end of the text.
    i = skipSpace(text, i);
    if (stack.length === 0) {
      if (i < end) {
        return invalid({
          at: i,
          message: `Expected the end of the JSON but found ${describe(text, i)}. JSON holds one top-level value; put several values in an array.`,
        });
      }
      break;
    }
    const open = stack[stack.length - 1] === OPEN_BRACE ? OPEN_BRACE : OPEN_BRACKET;
    const close = open === OPEN_BRACE ? CLOSE_BRACE : CLOSE_BRACKET;
    const code = text.charCodeAt(i);
    if (code === COMMA) {
      out.push(",");
      if (pretty) out.push(lineBreak(stack.length));
      i += 1;
      wantValue = true;
      afterComma = true;
      if (open === OPEN_BRACE) {
        const next = readName(text, i, out, pretty, true);
        if (typeof next !== "number") return invalid(next);
        i = next;
        afterComma = false;
      }
      continue;
    }
    if (code === close) {
      stack.pop();
      if (pretty) out.push(lineBreak(stack.length));
      out.push(open === OPEN_BRACE ? "}" : "]");
      i += 1;
      continue;
    }
    const closer = open === OPEN_BRACE ? '"}"' : '"]"';
    const what = open === OPEN_BRACE ? "object" : "array";
    return invalid({
      at: i,
      message:
        i >= end
          ? `The JSON ends before this ${what} is closed with ${closer}.`
          : code === SLASH
            ? comments()
            : `Expected "," or ${closer} after a value in this ${what} but found ${describe(text, i)}.`,
    });
  }

  if (end > stepSize) yield;
  const output = out.join("");
  return { ok: true, output, ...measure(output) };
}

/** Formats or minifies the JSON in one go. */
export function run(input: Input): Result {
  const steps = formatInSteps(input, Number.POSITIVE_INFINITY);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** The lines and characters (code points, so an emoji is one) of a text. */
export function measure(text: string): { lines: number; characters: number } {
  let lines = 1;
  let lowSurrogates = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === LINE_FEED) lines++;
    else if (code >= 0xdc00 && code <= 0xdfff) lowSurrogates++;
  }
  return { lines, characters: text.length - lowSurrogates };
}

function skipSpace(text: string, from: number): number {
  let i = from;
  for (;;) {
    const code = text.charCodeAt(i);
    if (code === SPACE || code === LINE_FEED || code === CARRIAGE_RETURN || code === TAB) i++;
    else return i;
  }
}

/** Reads `"name":` at `from` (after spaces), writes it to `out`, and returns where the value starts. */
function readName(
  text: string,
  from: number,
  out: string[],
  pretty: boolean,
  afterComma: boolean,
): number | Failure {
  const i = skipSpace(text, from);
  const code = text.charCodeAt(i);
  if (code !== QUOTE) {
    let message: string;
    if (i >= text.length) message = "The JSON ends where a property name was expected.";
    else if (code === APOSTROPHE) message = singleQuotes();
    else if (code === CLOSE_BRACE && afterComma) message = trailingComma("}");
    else if (code === SLASH) message = comments();
    else if (isWordCode(code)) message = "Property names must be in double quotes.";
    else message = `Expected a property name in double quotes but found ${describe(text, i)}.`;
    return { at: i, message };
  }
  const end = scanString(text, i);
  if (typeof end !== "number") return end;
  const colon = skipSpace(text, end);
  if (text.charCodeAt(colon) !== COLON) {
    return {
      at: colon,
      message: `Expected ":" after the property name but found ${describe(text, colon)}.`,
    };
  }
  out.push(text.slice(i, end), pretty ? ": " : ":");
  return colon + 1;
}

/** Reads a string, number, true, false or null at `i`, and returns where it ends. */
function readScalar(text: string, i: number, afterComma: boolean): number | Failure {
  const code = text.charCodeAt(i);
  if (code === QUOTE) return scanString(text, i);
  if (code === MINUS || isDigit(code)) return scanNumber(text, i);
  if (text.startsWith("true", i) || text.startsWith("null", i)) return i + 4;
  if (text.startsWith("false", i)) return i + 5;
  let message: string;
  if (i >= text.length) message = "The JSON ends where a value was expected.";
  else if (code === APOSTROPHE) message = singleQuotes();
  else if (code === SLASH) message = comments();
  else if (code === CLOSE_BRACKET && afterComma) message = trailingComma("]");
  else {
    message = `Expected a value (an object, array, string, number, true, false or null) but found ${describe(text, i)}.`;
  }
  return { at: i, message };
}

/** Checks the string that opens at `start` and returns the index after its closing quote. */
function scanString(text: string, start: number): number | Failure {
  let i = start + 1;
  for (;;) {
    if (i >= text.length) {
      return { at: start, message: "This string is never closed with a double quote." };
    }
    const code = text.charCodeAt(i);
    if (code === QUOTE) return i + 1;
    if (code === BACKSLASH) {
      const letter = text.charAt(i + 1);
      if (letter === "" || !ESCAPES.includes(letter)) {
        return {
          at: i,
          message:
            'A backslash in a string must start an escape: \\" \\\\ \\/ \\b \\f \\n \\r \\t or \\u and four hexadecimal digits.',
        };
      }
      if (letter === "u") {
        if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
          return { at: i, message: "\\u must be followed by four hexadecimal digits." };
        }
        i += 6;
      } else {
        i += 2;
      }
      continue;
    }
    if (code < SPACE) {
      return {
        at: i,
        message: `A string cannot hold ${describe(text, i)}; write it as an escape such as \\n or \\t, or close the string with a double quote.`,
      };
    }
    i++;
  }
}

/** Checks the number that starts at `start` and returns the index after it. */
function scanNumber(text: string, start: number): number | Failure {
  let i = start;
  if (text.charCodeAt(i) === MINUS) {
    i++;
    if (!isDigit(text.charCodeAt(i))) {
      return { at: i, message: `Expected a digit after "-" but found ${describe(text, i)}.` };
    }
  }
  if (text.charCodeAt(i) === ZERO) {
    i++;
    if (isDigit(text.charCodeAt(i))) {
      return { at: start, message: "A number cannot start with a leading zero." };
    }
  } else {
    while (isDigit(text.charCodeAt(i))) i++;
  }
  if (text.charCodeAt(i) === DOT) {
    i++;
    if (!isDigit(text.charCodeAt(i))) {
      return {
        at: i,
        message: `Expected a digit after the decimal point but found ${describe(text, i)}.`,
      };
    }
    while (isDigit(text.charCodeAt(i))) i++;
  }
  const exponent = text.charCodeAt(i);
  if (exponent === 0x65 || exponent === 0x45) {
    i++;
    const sign = text.charCodeAt(i);
    if (sign === PLUS || sign === MINUS) i++;
    if (!isDigit(text.charCodeAt(i))) {
      return { at: i, message: `Expected a digit in the exponent but found ${describe(text, i)}.` };
    }
    while (isDigit(text.charCodeAt(i))) i++;
  }
  return i;
}

function isDigit(code: number): boolean {
  return code >= ZERO && code <= NINE;
}

/** A letter, digit, _ or $: a character of an unquoted word such as undefined or NaN. */
function isWordCode(code: number): boolean {
  return (
    isDigit(code) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === UNDERSCORE ||
    code === DOLLAR
  );
}

function singleQuotes(): string {
  return "Strings and property names must be in double quotes, not single quotes.";
}

function comments(): string {
  return "JSON does not allow comments.";
}

function trailingComma(closer: string): string {
  return `Remove the comma before "${closer}": JSON does not allow a trailing comma.`;
}

/** The text with every control character (a tab, a line break) turned into a space. */
function flatten(text: string): string {
  let flat = "";
  for (let i = 0; i < text.length; i++) {
    flat += text.charCodeAt(i) < SPACE ? " " : text.charAt(i);
  }
  return flat;
}

/** What is at `i`, as the error message names it: a word, a character, or the end of the text. */
export function describe(text: string, i: number): string {
  if (i >= text.length) return "the end of the text";
  const code = text.charCodeAt(i);
  if (code === LINE_FEED || code === CARRIAGE_RETURN) return "a line break";
  if (code === TAB) return "a tab";
  if (code < SPACE)
    return `a control character (U+${code.toString(16).toUpperCase().padStart(4, "0")})`;
  if (isWordCode(code) && !isDigit(code)) {
    let end = i + 1;
    while (end < text.length && end - i < 20 && isWordCode(text.charCodeAt(end))) end++;
    return `"${text.slice(i, end)}"`;
  }
  return `"${String.fromCodePoint(text.codePointAt(i) ?? code)}"`;
}

/** The line, the column and a pointer for a failure. */
function locate(text: string, failure: Failure): JsonError {
  const at = Math.min(failure.at, text.length);
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < at; i++) {
    if (text.charCodeAt(i) === LINE_FEED) {
      line++;
      lineStart = i + 1;
    }
  }
  let lineEnd = at;
  while (lineEnd < text.length) {
    const code = text.charCodeAt(lineEnd);
    if (code === LINE_FEED || code === CARRIAGE_RETURN) break;
    lineEnd++;
  }
  const column = measure(text.slice(lineStart, at)).characters + 1;

  const from = Math.max(lineStart, at - POINTER_REACH);
  const to = Math.min(lineEnd, at + POINTER_REACH);
  const head = from > lineStart ? "…" : "";
  const tail = to < lineEnd ? "…" : "";
  // Tabs and control characters become spaces, so the caret lines up under the spot.
  const excerpt = flatten(text.slice(from, to));
  const caret = " ".repeat(head.length + measure(text.slice(from, at)).characters);
  return {
    message: failure.message,
    line,
    column,
    pointer: `${head}${excerpt}${tail}\n${caret}^`,
  };
}
