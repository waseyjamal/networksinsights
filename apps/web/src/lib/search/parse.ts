// Reads the search index in the browser. Kept apart from index-build.ts, which uses node:crypto.

import type { SearchRecord } from "./types";

/**
 * Reads a fetched index. Returns undefined for anything that is not one, so a stale or damaged
 * file becomes the "search is unavailable" state instead of an exception.
 */
export function parseSearchIndex(value: unknown): readonly SearchRecord[] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const file = value as { version?: unknown; tools?: unknown };
  if (file.version !== 1 || !Array.isArray(file.tools)) return undefined;
  const isText = (item: unknown): item is string => typeof item === "string";
  const records: SearchRecord[] = [];
  for (const item of file.tools as unknown[]) {
    const record = item as Partial<SearchRecord> | null;
    if (
      !record ||
      !isText(record.id) ||
      !isText(record.name) ||
      !isText(record.summary) ||
      !isText(record.category) ||
      !isText(record.href) ||
      // A tool's page on this site: `/word-counter/`. Never another origin, never a scheme.
      !record.href.startsWith("/") ||
      record.href.startsWith("//") ||
      !Array.isArray(record.tags) ||
      !record.tags.every(isText)
    ) {
      return undefined;
    }
    records.push(record as SearchRecord);
  }
  return records;
}
