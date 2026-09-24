// The search index, generated at build time from the registry (ADR 0045).
//
// It holds what the manifest says and nothing else, for the tools a visitor can be sent to: a
// deprecated tool has a noindex page (ToolPage.astro) and is not searchable either. The file is
// emitted as /search-index.<hash>.json, where the hash is of the content, so the file can be cached
// for good and a change of one word gives a new address.

import { createHash } from "node:crypto";
import type { Tool } from "../registry/build";
import type { SearchIndexFile, SearchRecord } from "./types";

/** Hex digits of the content hash in the file name. Twelve is 48 bits: no realistic collision. */
export const HASH_LENGTH = 12;

/** The tools a visitor may be sent to from search. */
export function isSearchable(tool: Tool): boolean {
  return tool.manifest.status !== "deprecated";
}

export function toRecord(tool: Tool): SearchRecord {
  const { manifest } = tool;
  return {
    id: manifest.id,
    name: manifest.name,
    summary: manifest.summary,
    category: manifest.category,
    tags: [...manifest.tags],
    // Left out, not null, when the manifest has none: the file stays small and the type stays honest.
    ...(manifest.accepts ? { accepts: [...manifest.accepts] } : {}),
    ...(manifest.produces ? { produces: [...manifest.produces] } : {}),
    href: tool.href,
  };
}

/** The index for a set of tools. Sorted by id, so the same tools always give the same bytes. */
export function buildSearchIndex(tools: readonly Tool[]): SearchIndexFile {
  return {
    version: 1,
    tools: tools
      .filter(isSearchable)
      .map(toRecord)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

export interface SerializedIndex {
  json: string;
  hash: string;
  /** Where the file is served: `/search-index.<hash>.json`. */
  href: string;
}

export const searchIndexHref = (hash: string) => `/search-index.${hash}.json`;

export function serializeSearchIndex(index: SearchIndexFile): SerializedIndex {
  const json = JSON.stringify(index);
  const hash = createHash("sha256").update(json).digest("hex").slice(0, HASH_LENGTH);
  return { json, hash, href: searchIndexHref(hash) };
}
