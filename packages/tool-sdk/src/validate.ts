// Every rule the build enforces on a tool folder (ADR 0033).
//
// This function is pure: folders in, problems out. The web app's registry gathers the folders and
// throws; the generator and `pnpm check:tools` use the same rules. Each problem names the folder,
// says exactly what is wrong and, where it can, what to change, so a failing build is readable.

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
  /**
   * The text of the code files (`logic.ts`, `ui.tsx`, `logic.test.ts`, `worker.ts`), keyed by
   * file name, for the quality gate that refuses unfinished code (ADR 0036).
   */
  sources?: Readonly<Record<string, string>> | undefined;
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
  /** The quality gate that found it (ADR 0036). Absent for a contract rule. */
  gate?: string;
  /** The file to open, relative to `dir`: `content/en.mdx`. */
  file?: string;
  /** What to do about it, in plain words. */
  fix?: string;
  /** A correct value or a correct line, where that helps. */
  example?: string;
}

/**
 * The single message format for a broken rule. The first line is always
 * `<what broke>: <folder> — <problem>`; the lines under it say where to look and what to change.
 */
export function formatViolation(violation: ContractViolation): string {
  const { dir, problem, gate, file, fix, example } = violation;
  const lines = [
    gate === undefined
      ? `Tool contract: ${dir} — ${problem}`
      : `Quality gate "${gate}": ${dir} — ${problem}`,
  ];
  if (file !== undefined) lines.push(`    File:    ${dir}/${file}`);
  if (fix !== undefined) lines.push(`    Fix:     ${fix}`);
  if (example !== undefined)
    lines.push(`    Example: ${example.replaceAll("\n", "\n             ")}`);
  return lines.join("\n");
}

/** Indents every line of a message, so a multi-line message stays inside a list. */
export function indentMessage(message: string, indent = "  "): string {
  return message
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

/** Thrown at build time, listing every problem found rather than only the first. */
export class ToolContractError extends Error {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    const lines = violations.map((violation) => indentMessage(formatViolation(violation)));
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

/** One problem before it is attached to a folder. */
type Detail = Omit<ContractViolation, "dir">;

function checkManifest(
  entry: ToolEntry,
  options: ValidateOptions,
): { manifest?: ToolManifest; problems: Detail[] } {
  const problems: Detail[] = [];
  if (entry.manifest === undefined || entry.manifest === null) {
    return {
      problems: [
        {
          problem:
            "tool.config.ts must have a default export: `export default defineTool({ ... })`",
          file: "tool.config.ts",
          fix: "export the manifest as the default export of tool.config.ts",
          example: 'export default defineTool({ id: "word-counter", name: "Word counter", ... });',
        },
      ],
    };
  }

  const parsed = toolManifestSchema.safeParse(entry.manifest);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".");
      problems.push({
        problem: field ? `manifest field \`${field}\`: ${issue.message}` : issue.message,
        file: "tool.config.ts",
        fix: field
          ? `change the \`${field}\` field in tool.config.ts as the message says`
          : "change tool.config.ts as the message says",
      });
    }
    return { problems };
  }

  const manifest = parsed.data as ToolManifest;
  const folder = folderParts(entry.dir);
  const file = "tool.config.ts";

  if (manifest.id !== folder.id) {
    problems.push({
      problem: `id is "${manifest.id}" but the folder is named "${folder.id}"; they must match, because the folder name is the URL`,
      file,
      fix: `set id to "${folder.id}", or rename the folder to "${manifest.id}"`,
    });
  }
  if (manifest.category !== folder.category) {
    problems.push({
      problem: `category is "${manifest.category}" but the folder sits in "${folder.category}"; they must match`,
      file,
      fix: `set category to "${folder.category}", or move the folder into tools/${manifest.category}/`,
    });
  }
  if (options.reservedPaths.includes(manifest.id)) {
    problems.push({
      problem: `id "${manifest.id}" is a reserved path: it is already a category slug or a static page`,
      file,
      fix: "choose another id and rename the folder to match; a tool's id is its URL",
    });
  }
  if (!options.categoryIds.includes(manifest.category)) {
    problems.push({
      problem: `category "${manifest.category}" is not in the categories config (expected one of: ${options.categoryIds.join(", ")})`,
      file,
      fix: "use a category id from apps/web/src/config/categories.ts",
      example: `category: "${options.categoryIds[0] ?? "text"}"`,
    });
  }
  if (manifest.related.includes(manifest.id)) {
    problems.push({
      problem: `related must not contain the tool's own id, "${manifest.id}"`,
      file,
      fix: "remove the tool's own id from related",
    });
  }
  if (manifest.updated < manifest.added) {
    problems.push({
      problem: `updated (${manifest.updated}) is earlier than added (${manifest.added})`,
      file,
      fix: "set updated to the date of the last change, never before added",
    });
  }

  return { manifest, problems };
}

function checkFiles(entry: ToolEntry): Detail[] {
  const problems: Detail[] = [];
  const files = new Set(entry.files);
  for (const required of REQUIRED_FILES) {
    if (!files.has(required)) {
      problems.push({
        problem: `is missing the required file ${required}`,
        fix: `create ${required}; \`pnpm new:tool\` writes every required file for a new tool`,
      });
    }
  }
  if (entry.island !== undefined && normalizeSource(entry.island) !== ISLAND_SOURCE) {
    problems.push({
      problem:
        "island.astro must be the contract source, byte for byte: it is the glue that mounts ui.tsx, not a place for tool code",
      file: "island.astro",
      fix: "restore the file to the contract source; put tool code in ui.tsx",
    });
  }
  if (entry.content !== undefined) {
    for (const problem of checkContent(entry.content)) {
      problems.push({
        problem,
        file: "content/en.mdx",
        fix: "write an intro paragraph, then the H2 sections How to use, Examples, Limits and FAQ in that order, and no H1",
      });
    }
  }
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
    for (const problem of problems) violations.push({ dir: entry.dir, ...problem });
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
        violations.push({
          dir,
          problem: `id "${id}" is also used by ${others(dirs, dir)}`,
          file: "tool.config.ts",
          fix: "give one of the tools a different id and rename its folder to match",
        });
      }
    }
  }
  for (const dirs of bySummary.values()) {
    if (dirs.length > 1) {
      for (const dir of dirs) {
        violations.push({
          dir,
          problem: `summary is the same as the summary of ${others(dirs, dir)}; every summary is a meta description and must be unique`,
          file: "tool.config.ts",
          fix: "rewrite the summary so it says what only this tool does",
        });
      }
    }
  }
  for (const [dir, manifest] of manifests) {
    for (const related of manifest.related) {
      if (!byId.has(related)) {
        violations.push({
          dir,
          problem: `related tool "${related}" does not exist`,
          file: "tool.config.ts",
          fix: "remove it from related, or create that tool first",
        });
      }
    }
  }

  return violations.sort((a, b) => a.dir.localeCompare(b.dir));
}

function others(dirs: readonly string[], self: string): string {
  return dirs.filter((dir) => dir !== self).join(", ");
}
