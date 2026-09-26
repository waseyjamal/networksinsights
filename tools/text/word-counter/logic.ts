// Pure logic of "Word Counter": no DOM, no network, no top-level statements, and imports only
// from zod, the SDK or this folder (docs/tool-contract.md, "logic.ts: what pure means").
//
// Words, characters and sentences follow Unicode text segmentation (UAX #29) through
// Intl.Segmenter, so an emoji made of several code points is one character and Chinese or
// Japanese text, written without spaces, still splits into words.

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  text: string;
}

/** Every count the tool shows. */
export interface Counts {
  /**
   * Words, as Unicode word segmentation finds them, with a hyphenated word counted once.
   * Punctuation and emoji are not words.
   */
  words: number;
  /** User-perceived characters (grapheme clusters), spaces and line breaks included. */
  characters: number;
  /** Characters that are not white space. */
  charactersNoSpaces: number;
  /** Sentences that hold at least one letter or digit. A line break also ends a sentence. */
  sentences: number;
  /** Blocks of text separated by one or more blank lines. */
  paragraphs: number;
  /** Reading time in whole seconds, rounded up, at WORDS_PER_MINUTE. */
  readingSeconds: number;
}

/** The silent reading speed used for the reading time: an average for adults reading English prose. */
export const WORDS_PER_MINUTE = 238;

/** How many UTF-16 units `countInSteps` handles between two pauses. */
export const STEP_SIZE = 32_768;

const WHITE_SPACE = /^\s+$/u;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const LETTER_OR_DIGIT_START = /^[\p{L}\p{N}]/u;
/** White space, or the full stops and commas of Chinese and Japanese, which are written without spaces. */
const STEP_BREAK_AFTER = /^[\s\u3001\u3002\uff01\uff0c\uff1f]$/u;
const HYPHEN = /^[-\u2010\u2011]$/u;
const BLANK_LINE = /\n[^\S\n]*\n/;

/** The counts of one text, all at once. */
export function run(input: Input): Counts {
  const steps = countInSteps(input.text, Number.POSITIVE_INFINITY);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * The counts of one text, in steps of about `stepSize` UTF-16 units: the generator yields after
 * each step and returns the counts. A caller that pauses between steps keeps the page responsive
 * on a very long text, and can drop the run when the text changes. The result is the same as
 * `run()` for any step size.
 */
export function* countInSteps(text: string, stepSize = STEP_SIZE): Generator<void, Counts> {
  const graphemes = new Intl.Segmenter([], { granularity: "grapheme" });
  const wordSegments = new Intl.Segmenter([], { granularity: "word" });
  let words = 0;
  let characters = 0;
  let charactersNoSpaces = 0;

  let start = 0;
  while (start < text.length) {
    const end = stepEnd(text, start, stepSize);
    const part = text.slice(start, end);
    for (const { segment } of graphemes.segment(part)) {
      characters++;
      if (!WHITE_SPACE.test(segment)) charactersNoSpaces++;
    }
    // "e-mail" and "well-known" are one word each, as a reader counts them; Unicode splits them.
    let afterWord = false;
    let afterHyphenInWord = false;
    for (const { segment, isWordLike } of wordSegments.segment(part)) {
      if (isWordLike) {
        if (!afterHyphenInWord) words++;
        afterWord = true;
        afterHyphenInWord = false;
      } else {
        afterHyphenInWord = afterWord && HYPHEN.test(segment);
        afterWord = false;
      }
    }
    start = end;
    if (start < text.length) yield;
  }

  return {
    words,
    characters,
    charactersNoSpaces,
    sentences: countSentences(text),
    paragraphs: countParagraphs(text),
    readingSeconds: readingSeconds(words),
  };
}

/** Reading time in whole seconds for a number of words, rounded up. */
export function readingSeconds(words: number): number {
  return Math.ceil((words * 60) / WORDS_PER_MINUTE);
}

/** "0 sec", "45 sec", "3 min", "3 min 5 sec", "1 h 2 min": short enough for a result tile. */
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  if (minutes > 0) return seconds > 0 ? `${minutes} min ${seconds} sec` : `${minutes} min`;
  return `${seconds} sec`;
}

/**
 * Where a step that begins at `start` ends. A step ends only between white space (or a CJK full
 * stop or comma) and a letter or digit: no character and no word crosses that point, so the counts of the steps add up to the
 * counts of the whole text. A text with no such point is one step.
 */
function stepEnd(text: string, start: number, stepSize: number): number {
  if (text.length - start <= stepSize) return text.length;
  for (let index = start + stepSize; index < text.length; index++) {
    if (
      STEP_BREAK_AFTER.test(text[index - 1] ?? "") &&
      LETTER_OR_DIGIT_START.test(text.slice(index, index + 2))
    ) {
      return index;
    }
  }
  return text.length;
}

function countSentences(text: string): number {
  const sentences = new Intl.Segmenter([], { granularity: "sentence" });
  let count = 0;
  for (const { segment } of sentences.segment(text)) {
    if (HAS_LETTER_OR_DIGIT.test(segment)) count++;
  }
  return count;
}

function countParagraphs(text: string): number {
  let count = 0;
  for (const block of text.replace(/\r\n?/g, "\n").split(BLANK_LINE)) {
    if (block.trim() !== "") count++;
  }
  return count;
}
