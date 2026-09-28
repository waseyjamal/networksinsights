// Pure logic of "Case Converter": no DOM, no network, no top-level statements, and imports only
// from zod, the SDK or this folder (docs/tool-contract.md, "logic.ts: what pure means").
//
// Letters, digits and marks are found with Unicode property escapes (\p{L}, \p{M}, \p{N}), and
// strings are walked by code point, never by UTF-16 unit, so accented letters, scripts other than
// Latin, emoji and Chinese or Japanese text come through whole. Scripts without case (Chinese,
// Japanese, Arabic, emoji) are left as they are.

/** The eight cases, in the order the workspace shows them. */
export const MODES = [
  "upper",
  "lower",
  "title",
  "sentence",
  "camel",
  "pascal",
  "snake",
  "kebab",
] as const;

export type Mode = (typeof MODES)[number];

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  text: string;
  mode: Mode;
}

/** What the tool gives back. */
export interface Result {
  output: string;
}

/** Each case's button label, written in that case. */
export const MODE_LABELS: Readonly<Record<Mode, string>> = {
  upper: "UPPERCASE",
  lower: "lowercase",
  title: "Title Case",
  sentence: "Sentence case",
  camel: "camelCase",
  pascal: "PascalCase",
  snake: "snake_case",
  kebab: "kebab-case",
};

/**
 * English words that title case leaves in lowercase unless they begin or end a line or follow a
 * colon, a dash or the end of a sentence: articles, coordinating conjunctions and short
 * prepositions.
 */
export const MINOR_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "and",
  "but",
  "or",
  "nor",
  "as",
  "at",
  "by",
  "for",
  "in",
  "of",
  "off",
  "on",
  "per",
  "to",
  "up",
  "via",
  "vs",
]);

/** A word for title case: letters, marks and digits, with an apostrophe inside (don't, O’Brien). */
const TITLE_WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;
/** Between two words, one of these makes the next word start a new phrase in title case. */
const PHRASE_BREAK = /[:.!?;—–]/u;
/** A line break of any platform, kept by split() because of the group. */
const LINE_BREAK = /(\r\n|\r|\n)/;
/** The run of letters, marks and digits that makes one or more words of a name. */
const NAME_RUN = /[\p{L}\p{M}\p{N}]+/gu;
/** An apostrophe between two letters: removed before names are built, so don't becomes dont. */
const INNER_APOSTROPHE = /(?<=[\p{L}\p{M}\p{N}])['’](?=\p{L})/gu;
/** fooBar, v2Api: a lowercase letter or digit followed by a capital starts a new word. */
const LOWER_TO_UPPER = /([\p{Ll}\p{N}])(\p{Lu})/gu;
/** XMLHttp: the last capital of a run of capitals starts a new word when a lowercase follows. */
const ACRONYM_END = /(\p{Lu})(\p{Lu}\p{Ll})/gu;
/**
 * The English pronoun "I" on its own or in I'm, I'll, I've and I'd, but not the "i" of "i.e.".
 * Used by sentence case, which lowercases everything else.
 */
const PRONOUN_I = /(?<![\p{L}\p{M}\p{N}_'’])i(?![\p{L}\p{M}\p{N}_]|\.\p{L})/gu;
const LETTER = /\p{L}/u;
const DIGIT = /\p{N}/u;
const WHITE_SPACE = /\s/u;
const SENTENCE_END = /[.!?…。！？]/u;
/** Closing quotes and brackets may sit between the end of a sentence and the space after it. */
const CLOSER = /["'”’)\]»」』]/u;

/** The text in the chosen case. */
export function run(input: Input): Result {
  return { output: convert(input.text, input.mode) };
}

/** The text in one case. */
export function convert(text: string, mode: Mode): string {
  switch (mode) {
    case "upper":
      return text.toUpperCase();
    case "lower":
      return text.toLowerCase();
    case "title":
      return eachLine(text, titleLine);
    case "sentence":
      return sentenceCase(text);
    case "camel":
      return eachLine(text, (line) =>
        nameWords(line)
          .map((word, index) => (index === 0 ? word.toLowerCase() : capitalize(word)))
          .join(""),
      );
    case "pascal":
      return eachLine(text, (line) => nameWords(line).map(capitalize).join(""));
    case "snake":
      return eachLine(text, (line) => nameWords(line).join("_").toLowerCase());
    case "kebab":
      return eachLine(text, (line) => nameWords(line).join("-").toLowerCase());
  }
}

/**
 * The words of one line as a programmer's name reads them: runs of letters and digits, split again
 * where the case changes (fooBar, XMLHttpRequest), with apostrophes inside a word removed.
 * Punctuation, spaces, symbols and emoji only separate words.
 */
export function nameWords(line: string): string[] {
  const words: string[] = [];
  for (const [run] of line.replace(INNER_APOSTROPHE, "").matchAll(NAME_RUN)) {
    const split = run.replace(LOWER_TO_UPPER, "$1 $2").replace(ACRONYM_END, "$1 $2");
    for (const word of split.split(" ")) if (word !== "") words.push(word);
  }
  return words;
}

/** The first code point in uppercase and the rest in lowercase. */
function capitalize(word: string): string {
  const first = String.fromCodePoint(word.codePointAt(0) ?? 0);
  return first.toUpperCase() + word.slice(first.length).toLowerCase();
}

/** Converts every line on its own and keeps the line breaks exactly as they were. */
function eachLine(text: string, convertLine: (line: string) => string): string {
  const parts = text.split(LINE_BREAK);
  // split() with a group puts the lines at even indexes and the breaks between them at odd ones.
  return parts.map((part, index) => (index % 2 === 0 ? convertLine(part) : part)).join("");
}

function titleLine(line: string): string {
  const lower = line.toLowerCase();
  const words = [...lower.matchAll(TITLE_WORD)];
  let output = "";
  let last = 0;
  words.forEach((match, index) => {
    const word = match[0];
    const start = match.index;
    const between = lower.slice(last, start);
    const edge = index === 0 || index === words.length - 1 || PHRASE_BREAK.test(between);
    output += between + (edge || !MINOR_WORDS.has(word) ? capitalize(word) : word);
    last = start + word.length;
  });
  return output + lower.slice(last);
}

/**
 * Lowercases the text, then capitalizes the first letter of the text, of every line and of every
 * sentence: after . ! ? … (or a Chinese or Japanese full stop) followed by white space. A digit
 * before the first letter means the sentence starts with a number, and the letter stays lowercase.
 */
function sentenceCase(text: string): string {
  let output = "";
  let capitalizeNext = true;
  let afterEnd = false;
  for (const char of text.toLowerCase()) {
    if (LETTER.test(char)) {
      output += capitalizeNext ? char.toUpperCase() : char;
      capitalizeNext = false;
      afterEnd = false;
      continue;
    }
    output += char;
    if (char === "\n" || char === "\r") {
      capitalizeNext = true;
    } else if (SENTENCE_END.test(char)) {
      afterEnd = true;
      if (char === "。" || char === "！" || char === "？") capitalizeNext = true;
    } else if (WHITE_SPACE.test(char)) {
      if (afterEnd) capitalizeNext = true;
      afterEnd = false;
    } else if (DIGIT.test(char)) {
      capitalizeNext = false;
      afterEnd = false;
    } else if (!CLOSER.test(char)) {
      afterEnd = false;
    }
  }
  return output.replace(PRONOUN_I, "I");
}
