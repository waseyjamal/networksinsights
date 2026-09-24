// The shapes of search (ADR 0045). Types only: the browser bundle and the build both import them.

/** One tool as the search index holds it. Exactly what the manifest says, nothing added. */
export interface SearchRecord {
  id: string;
  name: string;
  summary: string;
  /** The category id: `pdf`, `image`. The dialog looks the name and the accent up in its markup. */
  category: string;
  tags: readonly string[];
  accepts?: readonly string[];
  produces?: readonly string[];
  /** The tool's page, from `toolHref()`: `/word-counter/`. */
  href: string;
}

/** The file the build emits as `/search-index.<hash>.json`. */
export interface SearchIndexFile {
  version: 1;
  tools: readonly SearchRecord[];
}

/** A half-open span `[start, end)` of UTF-16 code units in the original text. */
export interface Range {
  start: number;
  end: number;
}

/** Formats a result matched through `accepts` or `produces`, for the one-line hint under it. */
export interface FormatHint {
  accepts: readonly string[];
  produces: readonly string[];
}

export interface SearchHit {
  record: SearchRecord;
  score: number;
  /** Where the query matched in the name and in the summary, for highlighting. */
  name: readonly Range[];
  summary: readonly Range[];
  /** Set only when nothing in the name or summary matched but a format did. */
  hint: FormatHint | undefined;
}

export interface SearchResults {
  /** Every tool that matched, which can be more than `hits`. */
  total: number;
  hits: readonly SearchHit[];
}

export interface SearchOptions {
  /** The most hits to return. Default 12. */
  limit?: number;
  /** False skips the highlight work, for a caller that needs only which tools matched. */
  highlight?: boolean;
}

/** A piece of a text, matched or not. The UI turns a matched piece into a `<mark>`. */
export interface Segment {
  text: string;
  match: boolean;
}
