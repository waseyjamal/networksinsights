// The search engine (ADR 0045): typo tolerance, prefix matching and field weights over a few
// hundred to a few thousand tools, in one small file with no dependency.
//
// Pure TypeScript: no DOM, no Node, no network. The browser loads it on demand (ADR 0046); the
// tests run it in Node.
//
// How a query is answered:
//   1. The text is folded (lower case, no accents) one UTF-16 unit for one unit, so an offset in
//      the folded text is an offset in the original. That is what makes safe highlighting possible.
//   2. Every query term is matched against the dictionary of terms in the index: exact, then
//      prefix. Only a term that matches neither is matched with typo tolerance.
//   3. A tool must match every term. Its score is the sum, over the terms, of the best field
//      weight times the match quality. A whole-name match and a "jpg to png" direction add bonuses.
//   4. The same matcher finds the spans to highlight in the top hits, so what is marked is exactly
//      what was matched.

import type {
  FormatHint,
  Range,
  SearchHit,
  SearchOptions,
  SearchRecord,
  SearchResults,
  Segment,
} from "./types";

/** name > tags > accepts/produces > summary. */
export const FIELD_WEIGHTS = { name: 10, tags: 5, accepts: 3, produces: 3, summary: 1 } as const;

const FIELD_NAME = 0;
const FIELD_TAGS = 1;
const FIELD_ACCEPTS = 2;
const FIELD_PRODUCES = 3;
const FIELD_SUMMARY = 4;
const WEIGHTS = [
  FIELD_WEIGHTS.name,
  FIELD_WEIGHTS.tags,
  FIELD_WEIGHTS.accepts,
  FIELD_WEIGHTS.produces,
  FIELD_WEIGHTS.summary,
] as const;

const DEFAULT_LIMIT = 12;
const MAX_QUERY_LENGTH = 100;
const MAX_TERMS = 8;

/** Words that carry no meaning in a query. Dropped unless the query is nothing else. */
const STOP_WORDS = new Set([
  "to",
  "into",
  "from",
  "a",
  "an",
  "the",
  "and",
  "for",
  "of",
  "in",
  "on",
  "with",
  "as",
  "online",
]);

/** Names of one format that readers use interchangeably. Each group matches as one word. */
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["jpg", "jpeg"],
  ["tif", "tiff"],
  ["md", "markdown"],
  ["yml", "yaml"],
];

const SYNONYMS = new Map<string, readonly string[]>(
  SYNONYM_GROUPS.flatMap((group) => group.map((word) => [word, group] as const)),
);

// ---------------------------------------------------------------------------------------------
// Folding and tokens

const foldCache = new Map<string, string>();

/** U+0300 to U+036F: the accents that a decomposed letter carries. */
const isCombiningMark = (code: number) => code >= 0x300 && code <= 0x36f;

const onlyMarks = (text: string) =>
  text.length > 0 && text.split("").every((unit) => isCombiningMark(unit.charCodeAt(0)));

/** One UTF-16 unit, lower-cased and stripped of its accent, as exactly one unit. */
function foldUnit(unit: string): string {
  const cached = foldCache.get(unit);
  if (cached !== undefined) return cached;
  const decomposed = unit.normalize("NFD");
  const base =
    decomposed.length > 1 && onlyMarks(decomposed.slice(1)) ? decomposed.charAt(0) : unit;
  const lower = base.toLowerCase();
  const folded = lower.length === 1 ? lower : base;
  foldCache.set(unit, folded);
  return folded;
}

/** Lower case without accents, and never a different length: offsets stay valid. */
export function fold(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) {
      out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : text.charAt(i);
    } else {
      out += foldUnit(text.charAt(i));
    }
  }
  return out;
}

const WORD_UNIT = /[\p{L}\p{N}]/u;

function isWordUnit(unit: string, code: number): boolean {
  if (code < 128) return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
  return isCombiningMark(code) || WORD_UNIT.test(unit);
}

export interface Token {
  /** The folded word, without combining marks. */
  term: string;
  /** Where the word sits in the original text. */
  start: number;
  end: number;
}

/** Runs of letters and digits. `H.264` is `h` and `264`; `PDF-to-Word` is three words. */
export function tokenize(text: string): Token[] {
  const folded = fold(text);
  const tokens: Token[] = [];
  let start = -1;
  for (let i = 0; i <= folded.length; i++) {
    const unit = folded.charAt(i);
    const inWord = i < folded.length && isWordUnit(unit, folded.charCodeAt(i));
    if (inWord) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      tokens.push({
        term: folded
          .slice(start, i)
          .split("")
          .filter((unit) => !isCombiningMark(unit.charCodeAt(0)))
          .join(""),
        start,
        end: i,
      });
      start = -1;
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------------------------
// Matching one query term against one word

/** Typos allowed in a word of this length. Short words are never guessed at. */
function allowedTypos(length: number): number {
  if (length < 4) return 0;
  return length < 7 ? 1 : 2;
}

/**
 * The edit distance between two words, counting a swap of neighbours as one edit, or `max + 1`
 * when it is more than `max`. Gives up early, so a far-off word costs almost nothing.
 */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  let beforePrevious: number[] = [];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let value = Math.min(
        (previous[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      if (
        i > 1 &&
        j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        value = Math.min(value, (beforePrevious[j - 2] ?? 0) + 1);
      }
      row.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    beforePrevious = previous;
    previous = row;
  }
  return previous[b.length] ?? max + 1;
}

/** A word of the query, with what it may match. */
interface QueryTerm {
  /** The word and its synonyms: `jpg` also matches `jpeg`. */
  alts: readonly string[];
  /** Set once the dictionary has no exact or prefix match for the word. */
  fuzzy: boolean;
  /** The word being typed: it may match as a prefix from its first letter, and typos in it too. */
  last: boolean;
}

/**
 * How well a word of a tool matches a query term: 1 exact, up to 0.9 for a prefix (more of the
 * word typed is better), 0.4 and 0.3 for one and two typos, 0.25 for a typo in an unfinished
 * word, 0 for no match.
 */
function quality(term: QueryTerm, word: string): number {
  let best = 0;
  for (const alt of term.alts) {
    if (word === alt) return 1;
    if (word.length > alt.length && word.startsWith(alt) && (term.last || alt.length >= 2)) {
      best = Math.max(best, 0.6 + (0.3 * alt.length) / word.length);
    } else if (term.fuzzy) {
      const typos = allowedTypos(alt.length);
      if (typos === 0) continue;
      const distance = editDistance(alt, word, typos);
      if (distance <= typos) {
        best = Math.max(best, distance === 1 ? 0.4 : 0.3);
      } else if (term.last && word.length > alt.length) {
        if (editDistance(alt, word.slice(0, alt.length), typos) <= typos)
          best = Math.max(best, 0.25);
      }
    }
  }
  return best;
}

/** How many letters of a word to mark: all of them, or only those typed when the match is a prefix. */
function markedLetters(term: QueryTerm, word: string): number {
  for (const alt of term.alts) {
    if (word === alt) return word.length;
    if (word.length > alt.length && word.startsWith(alt)) return alt.length;
  }
  return word.length;
}

/**
 * Where the first `letters` letters of a token end in the original text. A letter that carries a
 * combining accent is more than one UTF-16 unit there, so the count is of letters, not units.
 */
function endAfterLetters(text: string, token: Token, letters: number): number {
  let seen = 0;
  let i = token.start;
  while (i < token.end) {
    if (!isCombiningMark(text.charCodeAt(i))) {
      if (seen === letters) break;
      seen++;
    }
    i++;
  }
  return i;
}

// ---------------------------------------------------------------------------------------------
// The query

interface Compiled {
  terms: QueryTerm[];
  /** All words of the query, stop words included, joined: for the whole-name bonus. */
  key: string;
  /** `jpg to png`: the words either side of "to", when the query has that shape. */
  direction: { from: QueryTerm; to: QueryTerm } | undefined;
}

const termOf = (word: string, last: boolean): QueryTerm => ({
  alts: [word, ...(SYNONYMS.get(word)?.filter((other) => other !== word) ?? [])],
  fuzzy: false,
  last,
});

function compile(raw: string): Compiled | undefined {
  const text = raw.slice(0, MAX_QUERY_LENGTH).replace(/→|->/g, " to ");
  const all = tokenize(text).slice(0, MAX_TERMS);
  if (all.length === 0) return undefined;

  const meaningful = all.filter((token) => !STOP_WORDS.has(token.term));
  const used = meaningful.length > 0 ? meaningful : all;
  const terms = used.map((token, index) => termOf(token.term, index === used.length - 1));

  let direction: Compiled["direction"];
  const at = all.findIndex((token) => token.term === "to" || token.term === "into");
  const before = at > 0 ? all[at - 1] : undefined;
  const after = at >= 0 ? all[at + 1] : undefined;
  if (before && after)
    direction = { from: termOf(before.term, false), to: termOf(after.term, true) };

  return { terms, key: all.map((token) => token.term).join(" "), direction };
}

// ---------------------------------------------------------------------------------------------
// The index

interface Dictionary {
  /** Every distinct word in the index. */
  words: string[];
  /** Per word, flat quadruples: tool, field, start, end. */
  postings: number[][];
}

export interface Engine {
  search(query: string, options?: SearchOptions): SearchResults;
  readonly size: number;
}

/** Builds the engine over a list of records. Cost is one pass over their text. */
export function createEngine(records: readonly SearchRecord[]): Engine {
  const wordIds = new Map<string, number>();
  const dictionary: Dictionary = { words: [], postings: [] };
  const nameKeys: string[] = [];
  const accepts: string[][] = [];
  const produces: string[][] = [];

  const add = (tool: number, field: number, text: string) => {
    for (const token of tokenize(text)) {
      let id = wordIds.get(token.term);
      if (id === undefined) {
        id = dictionary.words.length;
        wordIds.set(token.term, id);
        dictionary.words.push(token.term);
        dictionary.postings.push([]);
      }
      dictionary.postings[id]?.push(tool, field, token.start, token.end);
    }
  };

  records.forEach((record, tool) => {
    add(tool, FIELD_NAME, record.name);
    for (const tag of record.tags) add(tool, FIELD_TAGS, tag);
    for (const format of record.accepts ?? []) add(tool, FIELD_ACCEPTS, format);
    for (const format of record.produces ?? []) add(tool, FIELD_PRODUCES, format);
    add(tool, FIELD_SUMMARY, record.summary);
    nameKeys.push(
      tokenize(record.name)
        .map((token) => token.term)
        .join(" "),
    );
    accepts.push((record.accepts ?? []).flatMap((format) => tokenize(format).map((t) => t.term)));
    produces.push((record.produces ?? []).flatMap((format) => tokenize(format).map((t) => t.term)));
  });

  /** The dictionary words a query term matches, each with its quality. */
  const resolve = (term: QueryTerm): Array<[number, number]> => {
    const scan = () => {
      const found: Array<[number, number]> = [];
      dictionary.words.forEach((word, id) => {
        const q = quality(term, word);
        if (q > 0) found.push([id, q]);
      });
      return found;
    };
    const found = scan();
    if (found.length > 0) return found;
    term.fuzzy = true;
    return scan();
  };

  const hasFormat = (words: readonly string[], term: QueryTerm) =>
    words.some((word) => term.alts.includes(word));

  const search = (query: string, options: SearchOptions = {}): SearchResults => {
    const { limit = DEFAULT_LIMIT, highlight = true } = options;
    const compiled = compile(query);
    if (!compiled || records.length === 0) return { total: 0, hits: [] };
    const { terms } = compiled;

    // The best weighted quality of each tool for each term, and whether the name held the term.
    const best = terms.map(() => new Float64Array(records.length));
    const inName = new Uint8Array(records.length);
    terms.forEach((term, index) => {
      const scores = best[index] as Float64Array;
      const named = new Uint8Array(records.length);
      for (const [id, q] of resolve(term)) {
        const postings = dictionary.postings[id] ?? [];
        for (let i = 0; i < postings.length; i += 4) {
          const tool = postings[i] as number;
          const field = postings[i + 1] as number;
          const score = (WEIGHTS[field] ?? 0) * q;
          if (score > (scores[tool] ?? 0)) scores[tool] = score;
          if (field === FIELD_NAME) named[tool] = 1;
        }
      }
      for (let tool = 0; tool < named.length; tool++)
        inName[tool] = (inName[tool] ?? 0) + (named[tool] ?? 0);
    });

    const candidates: Array<{ tool: number; score: number }> = [];
    for (let tool = 0; tool < records.length; tool++) {
      let score = 0;
      let all = true;
      for (const scores of best) {
        const value = scores[tool] ?? 0;
        if (value === 0) {
          all = false;
          break;
        }
        score += value;
      }
      if (!all) continue;

      const nameKey = nameKeys[tool] ?? "";
      if (nameKey === compiled.key) score += 100;
      else if (nameKey.startsWith(compiled.key)) score += 30;
      if (inName[tool] === terms.length) score += 6;
      const { direction } = compiled;
      if (
        direction &&
        hasFormat(accepts[tool] ?? [], direction.from) &&
        hasFormat(produces[tool] ?? [], direction.to)
      ) {
        score += 12;
      }
      candidates.push({ tool, score });
    }

    candidates.sort(
      (a, b) => b.score - a.score || (nameKeys[a.tool] ?? "").localeCompare(nameKeys[b.tool] ?? ""),
    );

    const hits = candidates.slice(0, Math.max(0, limit)).map(({ tool, score }): SearchHit => {
      const record = records[tool] as SearchRecord;
      if (!highlight) return { record, score, name: [], summary: [], hint: undefined };
      const name = rangesIn(record.name, terms);
      const summary = rangesIn(record.summary, terms);
      const hint = name.length === 0 && summary.length === 0 ? hintFor(record, terms) : undefined;
      return { record, score, name, summary, hint };
    });
    return { total: candidates.length, hits };
  };

  return { search, size: records.length };
}

// ---------------------------------------------------------------------------------------------
// Highlighting

/** The spans of a text the query matched, in order, without overlap. */
function rangesIn(text: string, terms: readonly QueryTerm[]): Range[] {
  const ranges: Range[] = [];
  for (const token of tokenize(text)) {
    let letters = 0;
    for (const term of terms) {
      if (quality(term, token.term) > 0) {
        letters = Math.max(letters, markedLetters(term, token.term));
      }
    }
    if (letters > 0) {
      ranges.push({ start: token.start, end: endAfterLetters(text, token, letters) });
    }
  }
  return ranges;
}

function hintFor(record: SearchRecord, terms: readonly QueryTerm[]): FormatHint | undefined {
  const matching = (formats: readonly string[] | undefined) =>
    (formats ?? []).filter((format) =>
      tokenize(format).some((token) => terms.some((term) => quality(term, token.term) > 0)),
    );
  const accepts = matching(record.accepts);
  const produces = matching(record.produces);
  return accepts.length + produces.length > 0 ? { accepts, produces } : undefined;
}

/**
 * Cuts a text at the ends of its ranges. Pure string work: the caller builds text nodes and
 * `<mark>` elements from the pieces, so no markup is ever parsed from a tool's own words.
 */
export function segments(text: string, ranges: readonly Range[]): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const range of ranges) {
    const start = Math.max(at, Math.min(range.start, text.length));
    const end = Math.max(start, Math.min(range.end, text.length));
    if (end === start) continue;
    if (start > at) out.push({ text: text.slice(at, start), match: false });
    out.push({ text: text.slice(start, end), match: true });
    at = end;
  }
  if (at < text.length) out.push({ text: text.slice(at), match: false });
  return out;
}
