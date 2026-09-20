// Every rule the build enforces on a tool folder (ADR 0033).
//
// This function is pure: folders in, problems out. The web app's registry gathers the folders and
// throws; the Mission 9 generator will use the same rules to check what it writes. Each problem
// names the folder and says exactly what is wrong, so a failing build is readable.

import { checkContent } from "./content";
import { ISLAND_SOURCE, normalizeSource, REQUIRED_FILES } from "./files";
import { toolManifestSchema } from "./manifest";
import type { ToolManifest } from "./types";

/** One tool folder, as read from disk or from a bundler glob. */
export interface ToolEntry {
  /** The folder, repo-relative and with forward slashes: `tools/text/word-counter`. */
  dir: string;
  /** The default export of its `tool.config.ts`, not yet validated. */
  manifest: unknown;
  /** The files that exist in the folder, relative to it: `logic.ts`, `content/en.mdx`. */
  files: readonly string[];
  /** The text of `content/en.mdx`, when the file exists. */
  content?: string | undefined;
  /** The text of `island.astro`, when the file exists. */
  island?: string | undefined;
}

/** What the tool set is checked against. */
export interface ValidateOptions {
  /** The ids in apps/web/src/config/categories.ts. */
  categoryIds: readonly string[];
  /** URL segments no tool id may take: category slugs and static pages (ADR 0030). */
  reservedPaths: readonly string[];
}

/** One broken rule in one folder. */
export interface ContractViolation {
  dir: string;
  problem: string;
}

/** The single message format for a broken contract. */
export function formatViolation({ dir, problem }: ContractViolation): string {
  return `Tool contract: ${dir} — ${problem}`;
}

/** Thrown at build time, listing every problem found rather than only the first. */
export class ToolContractError extends Error {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    const lines = violations.map((violation) => `  ${formatViolation(violation)}`);
    super(
      `${violations.length} tool contract ${violations.length === 1 ? "problem" : "problems"}:\n${lines.join("\n")}`,
    );
    this.name = "ToolContractError";
    this.violations = violations;
  }
}

/** The last two segments of the folder: `tools/text/word-counter` → text, word-counter. */
function folderParts(dir: string): { category: string; id: string } {
  const parts = dir.split("/").filter(Boolean);
  return { category: parts.at(-2) ?? "", id: parts.at(-1) ?? "" };
}

function checkManifest(
  entry: ToolEntry,
  options: ValidateOptions,
): { manifest?: ToolManifest; problems: string[] } {
  const problems: string[] = [];
  if (entry.manifest === undefined || entry.manifest === null) {
    return {
      problems: ["tool.config.ts must have a default export: `export default defineTool({ ... })`"],
    };
  }

  const parsed = toolManifestSchema.safeParse(entry.manifest);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".");
      problems.push(field ? `manifest field \`${field}\`: ${issue.message}` : issue.message);
    }
    return { problems };
  }

  const manifest = parsed.data as ToolManifest;
  const folder = folderParts(entry.dir);

  if (manifest.id !== folder.id) {
    problems.push(
      `id is "${manifest.id}" but the folder is named "${folder.id}"; they must match, because the folder name is the URL`,
    );
  }
  if (manifest.category !== folder.category) {
    problems.push(
      `category is "${manifest.category}" but the folder sits in "${folder.category}"; they must match`,
    );
  }
  if (options.reservedPaths.includes(manifest.id)) {
    problems.push(
      `id "${manifest.id}" is a reserved path: it is already a category slug or a static page`,
    );
  }
  if (!options.categoryIds.includes(manifest.category)) {
    problems.push(
      `category "${manifest.category}" is not in the categories config (expected one of: ${options.categoryIds.join(", ")})`,
    );
  }
  if (manifest.related.includes(manifest.id)) {
    problems.push(`related must not contain the tool's own id, "${manifest.id}"`);
  }
  if (manifest.updated < manifest.added) {
    problems.push(`updated (${manifest.updated}) is earlier than added (${manifest.added})`);
  }

  return { manifest, problems };
}

function checkFiles(entry: ToolEntry): string[] {
  const problems: string[] = [];
  const files = new Set(entry.files);
  for (const required of REQUIRED_FILES) {
    if (!files.has(required)) problems.push(`is missing the required file ${required}`);
  }
  if (entry.island !== undefined && normalizeSource(entry.island) !== ISLAND_SOURCE) {
    problems.push(
      "island.astro must be the contract source, byte for byte: it is the glue that mounts ui.tsx, not a place for tool code",
    );
  }
  if (entry.content !== undefined) problems.push(...checkContent(entry.content));
  return problems;
}

/**
 * Checks every tool folder and returns every problem found, in folder order.
 * An empty array means the tool set satisfies the contract.
 */
export function validateTools(
  entries: readonly ToolEntry[],
  options: ValidateOptions,
): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const manifests = new Map<string, ToolManifest>();

  const sorted = [...entries].sort((a, b) => a.dir.localeCompare(b.dir));

  for (const entry of sorted) {
    const { manifest, problems } = checkManifest(entry, options);
    problems.push(...checkFiles(entry));
    for (const problem of problems) violations.push({ dir: entry.dir, problem });
    if (manifest) manifests.set(entry.dir, manifest);
  }

  // Rules that need the whole set: uniqueness, and links between tools.
  const byId = new Map<string, string[]>();
  const bySummary = new Map<string, string[]>();
  for (const [dir, manifest] of manifests) {
    byId.set(manifest.id, [...(byId.get(manifest.id) ?? []), dir]);
    const summary = manifest.summary.trim().toLowerCase();
    bySummary.set(summary, [...(bySummary.get(summary) ?? []), dir]);
  }

  for (const [id, dirs] of byId) {
    if (dirs.length > 1) {
      for (const dir of dirs) {
        violations.push({ dir, problem: `id "${id}" is also used by ${others(dirs, dir)}` });
      }
    }
  }
  for (const dirs of bySummary.values()) {
    if (dirs.length > 1) {
      for (const dir of dirs) {
        violations.push({
          dir,
          problem: `summary is the same as the summary of ${others(dirs, dir)}; every summary is a meta description and must be unique`,
        });
      }
    }
  }
  for (const [dir, manifest] of manifests) {
    for (const related of manifest.related) {
      if (!byId.has(related)) {
        violations.push({ dir, problem: `related tool "${related}" does not exist` });
      }
    }
  }

  return violations.sort((a, b) => a.dir.localeCompare(b.dir));
}

function others(dirs: readonly string[], self: string): string {
  return dirs.filter((dir) => dir !== self).join(", ");
}
