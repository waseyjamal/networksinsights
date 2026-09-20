// The tool registry: folders in, an indexed, validated set of tools out (ADR 0033).
//
// This module holds metadata only. It never imports a tool's ui.tsx, island.astro or MDX, so the
// pages that list tools — the home page, /tools/ and the category pages — stay at zero framework
// JavaScript. Loading a tool's island and content is the job of islands.ts and content.ts, which
// only the tool page imports. zero-js.test.ts fails if that stops being true.

import {
  ToolContractError,
  type ToolEntry,
  type ToolManifest,
  validateTools,
} from "@networksinsights/tool-sdk";
import { categories, reservedPaths } from "../../config/categories";

/** One validated tool. */
export interface Tool {
  manifest: ToolManifest;
  /** The folder it came from, repo-relative: `tools/text/word-counter`. */
  dir: string;
  /** Its page: `/word-counter/` (ADR 0014). */
  href: string;
}

export interface Registry {
  /** Every tool, by name. */
  all: readonly Tool[];
  byId: ReadonlyMap<string, Tool>;
  /** Category id to its tools. Categories with no tools are absent. */
  byCategory: ReadonlyMap<string, readonly Tool[]>;
}

/** The canonical link to a tool page. Paths end in a slash (ADR 0030). */
export function toolHref(id: string): string {
  return `/${id}/`;
}

/**
 * Validates the folders and indexes them.
 *
 * Throws ToolContractError, listing every problem with the folder it is in, if any folder breaks
 * the contract. Every page imports the registry, so a broken tool fails the build rather than
 * shipping a broken page.
 */
export function buildRegistry(entries: readonly ToolEntry[]): Registry {
  const violations = validateTools(entries, {
    categoryIds: categories.map((category) => category.id),
    reservedPaths,
  });
  if (violations.length > 0) throw new ToolContractError(violations);

  const all = entries
    .map((entry) => {
      const manifest = entry.manifest as ToolManifest;
      return { manifest, dir: entry.dir, href: toolHref(manifest.id) };
    })
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

  const byCategory = new Map<string, Tool[]>();
  for (const tool of all) {
    byCategory.set(tool.manifest.category, [
      ...(byCategory.get(tool.manifest.category) ?? []),
      tool,
    ]);
  }

  return {
    all,
    byId: new Map(all.map((tool) => [tool.manifest.id, tool])),
    byCategory,
  };
}
