// Pure logic of "XML Formatter": the limits, the choices, a well-formedness check written here,
// and how an error becomes a line, a column and a pointer. No DOM, no network, no top-level
// statements (docs/tool-contract.md, "logic.ts: what pure means"). formatXml() is handed the
// `xml-formatter` library by worker.ts, which loads it only when the worker starts (ADR 0062);
// logic.ts imports nothing, and the tests hand it the same library. The library is lenient (it
// accepts a missing end tag), so every text is checked here first and only well-formed XML is
// printed.

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

export const INDENTS = ["2", "4", "tab"] as const;

export type Indent = (typeof INDENTS)[number];

export const INDENT_LABELS: Readonly<Record<Indent, string>> = {
  "2": "2 spaces",
  "4": "4 spaces",
  tab: "Tabs",
};

export interface Input {
  text: string;
  mode: Mode;
  indent: Indent;
}

/** What the check finds: the root element and how many elements, or the first error. */
export type Check =
  | { ok: true; root: string; elements: number }
  | { ok: false; message: string; offset: number };

/** What worker.ts sends back. An error without an offset is one the library raised. */
export type WorkerResult =
  | { ok: true; output: string; root: string; elements: number }
  | { ok: false; message: string; offset: number | null };

/** Where the XML went wrong. `line` and `column` count from 1. */
export interface Location {
  line: number;
  column: number;
  /** The line of the error, cut to about 80 characters around it, and a caret under the spot. */
  pointer: string;
}

export type Result =
  | {
      ok: true;
      output: string;
      root: string;
      elements: number;
      lines: number;
      characters: number;
    }
  | { ok: false; reason: "empty" | "tooLong" | "failed"; error: string }
  | { ok: false; reason: "invalid"; error: string; at: Location };

export const MESSAGES = {
  empty: "Paste or type XML to format it.",
  tooLong: (limit: string) =>
    `This text is longer than ${limit} characters. Split it into smaller parts.`,
  failed: "The XML could not be formatted. Try again.",
  noRoot: "There is no element here. XML needs one root element, such as <root>…</root>.",
  twoRoots:
    "XML allows one root element only. Wrap all the elements in one, such as <root>…</root>.",
  textOutside: "Text is not allowed outside the root element.",
  unclosed: (name: string) => `The element <${name}> is never closed. Add </${name}>.`,
  mismatch: (open: string, close: string) =>
    `The end tag </${close}> does not match the open element <${open}>. Close <${open}> first.`,
  strayEnd: (name: string) => `The end tag </${name}> has no start tag.`,
  badName: "An element or attribute name is expected here.",
  badTagEnd: (name: string) => `The tag <${name}> is not finished: expected > or />.`,
  badEndTag: (name: string) => `The end tag </${name}> is not finished: expected >.`,
  needsSpace: "Put a space between two attributes.",
  needsEquals: (name: string) => `The attribute ${name} needs = and a value in quotes.`,
  needsQuotes: (name: string) => `The value of the attribute ${name} must be in quotes.`,
  unclosedValue: (name: string) => `The value of the attribute ${name} is never closed.`,
  ltInValue: (name: string) => `The value of the attribute ${name} cannot contain <. Write &lt;.`,
  duplicate: (name: string) => `The attribute ${name} appears twice in the same tag.`,
  badReference: "An & must start a reference such as &amp;. Write &amp; for a plain &.",
  unknownEntity: (name: string) => `The entity &${name}; is not defined.`,
  badCharReference: (text: string) => `${text} is not a character XML allows.`,
  badCharacter: (code: string) => `The character ${code} is not allowed in XML.`,
  cdataEnd: "The text ]]> is not allowed here. Write ]]&gt;.",
  unclosedComment: "This comment is never closed. End it with -->.",
  doubleHyphen: "Two hyphens (--) are not allowed inside a comment.",
  unclosedCdata: "This CDATA section is never closed. End it with ]]>.",
  cdataOutside: "A CDATA section is allowed only inside the root element.",
  unclosedInstruction: "This processing instruction is never closed. End it with ?>.",
  lateDeclaration: "The XML declaration <?xml …?> must be the very first thing in the text.",
  doctypePlace: "The DOCTYPE must come once, before the root element.",
  unclosedDoctype: "The DOCTYPE is never closed. End it with >.",
  badMarkup: "This markup is not XML. A comment starts with <!-- and CDATA with <![CDATA[.",
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

const PREDEFINED = new Set(["amp", "lt", "gt", "quot", "apos"]);

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isNameStart(code: number): boolean {
  return (
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x41 && code <= 0x5a) ||
    code === 0x5f ||
    code === 0x3a ||
    code >= 0xc0
  );
}

function isNameChar(code: number): boolean {
  return (
    isNameStart(code) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2d ||
    code === 0x2e ||
    code === 0xb7
  );
}

/** Characters XML 1.0 allows: tab, line feed, carriage return, and U+0020 upward but U+FFFE/F. */
function isAllowedChar(code: number): boolean {
  if (code < 0x20) return code === 0x09 || code === 0x0a || code === 0x0d;
  return code !== 0xfffe && code !== 0xffff;
}

function hex(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

class XmlError {
  constructor(
    readonly message: string,
    readonly offset: number,
  ) {}
}

/**
 * Checks that the text is well-formed XML 1.0: one root element, every tag closed and nested
 * in order, attributes quoted and not repeated, references defined, comments, CDATA, processing
 * instructions and the DOCTYPE in their places, and no forbidden character. It does not fetch an
 * external DTD or check against a schema: with an external DTD, unknown entities are allowed.
 */
export function checkXml(text: string): Check {
  try {
    return scan(text);
  } catch (caught) {
    if (caught instanceof XmlError)
      return { ok: false, message: caught.message, offset: caught.offset };
    throw caught;
  }
}

function scan(text: string): Check {
  const length = text.length;
  const stack: { name: string; at: number }[] = [];
  const entities = new Set<string>();
  let lenientEntities = false;
  let root = "";
  let rootClosed = false;
  let sawDoctype = false;
  let elements = 0;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const fail = (message: string, at: number): never => {
    throw new XmlError(message, at);
  };

  const readName = (from: number): number => {
    if (from >= length || !isNameStart(text.charCodeAt(from))) fail(MESSAGES.badName, from);
    let end = from + 1;
    while (end < length && isNameChar(text.charCodeAt(end))) end++;
    return end;
  };

  const skipSpace = (from: number): number => {
    let at = from;
    while (at < length && isSpace(text.charCodeAt(at))) at++;
    return at;
  };

  /** Checks the reference at `at` (an &) and returns the index after its ;. */
  const reference = (at: number): number => {
    const end = text.indexOf(";", at);
    const body = end === -1 ? "" : text.slice(at + 1, end);
    if (body.startsWith("#")) {
      const match = /^#(?:x([0-9a-fA-F]+)|([0-9]+))$/.exec(body);
      if (!match) fail(MESSAGES.badReference, at);
      const code = match?.[1] ? Number.parseInt(match[1], 16) : Number(match?.[2]);
      if (!(code <= 0x10ffff) || !isAllowedChar(code) || (code >= 0xd800 && code <= 0xdfff)) {
        fail(MESSAGES.badCharReference(`&${body};`), at);
      }
      return end + 1;
    }
    const validName =
      body !== "" &&
      isNameStart(body.charCodeAt(0)) &&
      [...body].every((character) => isNameChar(character.charCodeAt(0)));
    if (!validName) {
      fail(MESSAGES.badReference, at);
    }
    if (!PREDEFINED.has(body) && !entities.has(body) && !lenientEntities) {
      fail(MESSAGES.unknownEntity(body), at);
    }
    return end + 1;
  };

  /** Checks plain text from `from` to `to`: characters, references and ]]>. */
  const textRun = (from: number, to: number, inside: boolean) => {
    for (let at = from; at < to; at++) {
      const code = text.charCodeAt(at);
      if (!inside && !isSpace(code)) fail(MESSAGES.textOutside, at);
      if (code === 0x26) {
        at = reference(at) - 1;
        continue;
      }
      if (code === 0x5d && text.startsWith("]]>", at)) fail(MESSAGES.cdataEnd, at);
      if (!isAllowedChar(code)) fail(MESSAGES.badCharacter(hex(code)), at);
    }
  };

  /** Checks one character range for forbidden characters only (comments, CDATA, PIs). */
  const plainRun = (from: number, to: number) => {
    for (let at = from; at < to; at++) {
      const code = text.charCodeAt(at);
      if (!isAllowedChar(code)) fail(MESSAGES.badCharacter(hex(code)), at);
    }
  };

  while (i < length) {
    const lt = text.indexOf("<", i);
    const textEnd = lt === -1 ? length : lt;
    if (textEnd > i) textRun(i, textEnd, stack.length > 0);
    if (lt === -1) break;
    i = lt;

    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end === -1) fail(MESSAGES.unclosedComment, i);
      const inner = text.indexOf("--", i + 4);
      if (inner !== -1 && inner < end) fail(MESSAGES.doubleHyphen, inner);
      if (text.charCodeAt(end - 1) === 0x2d) fail(MESSAGES.doubleHyphen, end - 1);
      plainRun(i + 4, end);
      i = end + 3;
      continue;
    }

    if (text.startsWith("<![CDATA[", i)) {
      if (stack.length === 0) fail(MESSAGES.cdataOutside, i);
      const end = text.indexOf("]]>", i + 9);
      if (end === -1) fail(MESSAGES.unclosedCdata, i);
      plainRun(i + 9, end);
      i = end + 3;
      continue;
    }

    if (text.startsWith("<!DOCTYPE", i)) {
      if (sawDoctype || root !== "") fail(MESSAGES.doctypePlace, i);
      sawDoctype = true;
      i = doctype(i);
      continue;
    }

    if (text.startsWith("<!", i)) fail(MESSAGES.badMarkup, i);

    if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i + 2);
      if (end === -1) fail(MESSAGES.unclosedInstruction, i);
      const nameEnd = readName(i + 2);
      const target = text.slice(i + 2, nameEnd);
      const first = text.charCodeAt(0) === 0xfeff ? 1 : 0;
      if (target.toLowerCase() === "xml" && i !== first) fail(MESSAGES.lateDeclaration, i);
      plainRun(i + 2, end);
      i = end + 2;
      continue;
    }

    if (text.startsWith("</", i)) {
      const nameEnd = readName(i + 2);
      const name = text.slice(i + 2, nameEnd);
      const close = skipSpace(nameEnd);
      if (text.charCodeAt(close) !== 0x3e) fail(MESSAGES.badEndTag(name), close);
      const open = stack.pop();
      if (!open) fail(MESSAGES.strayEnd(name), i);
      if (open && open.name !== name) fail(MESSAGES.mismatch(open.name, name), i);
      if (stack.length === 0) rootClosed = true;
      i = close + 1;
      continue;
    }

    // A start tag or an empty-element tag.
    const nameEnd = readName(i + 1);
    const name = text.slice(i + 1, nameEnd);
    if (rootClosed) fail(MESSAGES.twoRoots, i);
    if (root === "") root = name;
    elements++;
    let at = nameEnd;
    const seen = new Set<string>();
    for (;;) {
      const afterSpace = skipSpace(at);
      const code = text.charCodeAt(afterSpace);
      if (code === 0x3e) {
        stack.push({ name, at: i });
        i = afterSpace + 1;
        break;
      }
      if (code === 0x2f && text.charCodeAt(afterSpace + 1) === 0x3e) {
        if (stack.length === 0) rootClosed = true;
        i = afterSpace + 2;
        break;
      }
      if (afterSpace >= length || !isNameStart(code)) fail(MESSAGES.badTagEnd(name), afterSpace);
      if (afterSpace === at) fail(MESSAGES.needsSpace, afterSpace);
      const attributeEnd = readName(afterSpace);
      const attribute = text.slice(afterSpace, attributeEnd);
      if (seen.has(attribute)) fail(MESSAGES.duplicate(attribute), afterSpace);
      seen.add(attribute);
      const equals = skipSpace(attributeEnd);
      if (text.charCodeAt(equals) !== 0x3d) fail(MESSAGES.needsEquals(attribute), equals);
      const quoteAt = skipSpace(equals + 1);
      const quote = text.charCodeAt(quoteAt);
      if (quote !== 0x22 && quote !== 0x27) fail(MESSAGES.needsQuotes(attribute), quoteAt);
      const close = text.indexOf(String.fromCharCode(quote), quoteAt + 1);
      if (close === -1) fail(MESSAGES.unclosedValue(attribute), quoteAt);
      for (let v = quoteAt + 1; v < close; v++) {
        const valueCode = text.charCodeAt(v);
        if (valueCode === 0x3c) fail(MESSAGES.ltInValue(attribute), v);
        if (valueCode === 0x26) {
          v = reference(v) - 1;
          continue;
        }
        if (!isAllowedChar(valueCode)) fail(MESSAGES.badCharacter(hex(valueCode)), v);
      }
      at = close + 1;
    }
  }

  const open = stack.at(-1);
  if (open) fail(MESSAGES.unclosed(open.name), open.at);
  if (root === "") fail(MESSAGES.noRoot, length);
  return { ok: true, root, elements };

  /** Skips a DOCTYPE, reading the general entities it declares. Returns the index after it. */
  function doctype(start: number): number {
    let at = start + 9;
    let depth = 0;
    let subsetStart = -1;
    let subsetEnd = -1;
    while (at < length) {
      const code = text.charCodeAt(at);
      if (code === 0x22 || code === 0x27) {
        const close = text.indexOf(String.fromCharCode(code), at + 1);
        if (close === -1) break;
        at = close + 1;
        continue;
      }
      if (code === 0x5b) {
        if (depth === 0) subsetStart = at;
        depth++;
      } else if (code === 0x5d) {
        depth--;
        if (depth === 0) subsetEnd = at;
      } else if (code === 0x3e && depth === 0) {
        const head = text.slice(start, subsetStart === -1 ? at : subsetStart);
        if (/\b(SYSTEM|PUBLIC)\b/.test(head)) lenientEntities = true;
        if (subsetStart !== -1) {
          const subset = text.slice(subsetStart + 1, subsetEnd === -1 ? at : subsetEnd);
          for (const match of subset.matchAll(/<!ENTITY\s+([^\s%][^\s]*)\s/g)) {
            if (match[1]) entities.add(match[1]);
          }
          // A parameter entity can declare more entities than this check can read.
          if (/%[^\s;]+;/.test(subset)) lenientEntities = true;
        }
        return at + 1;
      }
      at++;
    }
    return fail(MESSAGES.unclosedDoctype, start);
  }
}

/** The parts of the `xml-formatter` library formatXml() uses, described by shape. */
export interface XmlFormatter {
  (xml: string, options: object): string;
  minify(xml: string, options: object): string;
}

/** The indentation string for a choice. */
export function indentation(indent: Indent): string {
  return indent === "tab" ? "\t" : " ".repeat(Number(indent));
}

/**
 * Checks the text, then prints it: Format with one element a line and the chosen indentation,
 * Minify with no whitespace between tags and no comments. An element holding only text stays on
 * one line, and so does mixed text and elements, so no space is added inside text.
 */
export function formatXml(format: XmlFormatter, input: Input): WorkerResult {
  const check = checkXml(input.text);
  if (!check.ok) return check;
  const text = input.text.charCodeAt(0) === 0xfeff ? input.text.slice(1) : input.text;
  try {
    const output =
      input.mode === "minify"
        ? format.minify(text, {
            collapseContent: true,
            lineSeparator: "\n",
            throwOnFailure: true,
            filter: (node: { type: string }) => node.type !== "Comment",
          })
        : format(text, {
            indentation: indentation(input.indent),
            collapseContent: true,
            lineSeparator: "\n",
            throwOnFailure: true,
          });
    return { ok: true, output: `${output}\n`, root: check.root, elements: check.elements };
  } catch {
    return { ok: false, message: MESSAGES.failed, offset: null };
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
