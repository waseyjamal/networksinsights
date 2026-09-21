// Finds and reads tool folders from disk, for the scripts (the generator, check:tools and
// check:budgets). The website reads the same folders through bundler globs (ADR 0033); this is the
// same reading done with plain Node, so a check can run without building the site.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type ContractViolation,
  ISLAND_SOURCE,
  REQUIRED_FILES,
  type ToolEntry,
} from "@networksinsights/tool-sdk";
import { categories, reservedPaths } from "../../apps/web/src/config/categories";
import { staticPagePaths } from "../../apps/web/src/config/site";
import { readManifestFields } from "./static-manifest";

/** The repo root: the folder above scripts/. */
export const repoRoot = join(import.meta.dirname, "..", "..");

/** Where the tools live in this repo (ADR 0032). */
export const defaultToolsRoot = join(repoRoot, "tools");

/** The code files whose text the quality gates read. */
const SOURCE_FILES = ["logic.ts", "ui.tsx", "logic.test.ts", "worker.ts"] as const;

/** The category ids, the reserved paths and the static pages, from the site's own config. */
export const siteConfig = {
  categoryIds: categories.map((category): string => category.id),
  categories,
  reservedPaths,
  staticPagePaths,
};

export const toPosix = (path: string) => path.split(sep).join("/");

const isDirectory = (path: string) => existsSync(path) && statSync(path).isDirectory();

/** A folder that starts with a dot is scratch space (a staging folder), and node_modules is not a category. */
const visible = (name: string) => !name.startsWith(".") && name !== "node_modules";

/** Every `<category>/<tool>` folder under the tools root, sorted, as [category, tool] pairs. */
export function listToolFolders(root: string): Array<[string, string]> {
  if (!isDirectory(root)) return [];
  const found: Array<[string, string]> = [];
  for (const category of readdirSync(root).filter(visible).sort()) {
    if (!isDirectory(join(root, category))) continue;
    for (const tool of readdirSync(join(root, category)).filter(visible).sort()) {
      if (isDirectory(join(root, category, tool))) found.push([category, tool]);
    }
  }
  return found;
}

/** A tool folder as read from disk, and anything that went wrong reading it. */
export interface LoadedTool {
  entry: ToolEntry;
  /** Absolute path of the folder. */
  path: string;
  /** Problems found while reading, before any rule ran: a config that throws when imported. */
  problems: ContractViolation[];
}

async function readManifest(
  path: string,
  dir: string,
): Promise<{ manifest: unknown; problems: ContractViolation[] }> {
  const file = join(path, "tool.config.ts");
  if (!existsSync(file)) return { manifest: undefined, problems: [] };
  try {
    const module = (await import(pathToFileURL(file).href)) as { default?: unknown };
    return { manifest: module.default, problems: [] };
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return {
      manifest: undefined,
      problems: [
        {
          dir,
          file: "tool.config.ts",
          problem: `tool.config.ts could not be loaded: ${reason}`,
          fix: "fix the error above; the file must import cleanly and default-export defineTool({ ... })",
        },
      ],
    };
  }
}

/**
 * Reads one tool folder: its manifest (by importing tool.config.ts), the files it has, and the
 * text of the files the gates read.
 */
export async function loadTool(root: string, category: string, id: string, label = "tools") {
  const path = join(root, category, id);
  const dir = `${label}/${category}/${id}`;
  const { manifest, problems } = await readManifest(path, dir);

  const files = readdirSync(path)
    .filter((name) => statSync(join(path, name)).isFile())
    .sort();
  const content = join(path, "content", "en.mdx");
  if (existsSync(content)) files.push("content/en.mdx");

  const sources: Record<string, string> = {};
  for (const name of SOURCE_FILES) {
    if (files.includes(name)) sources[name] = readFileSync(join(path, name), "utf8");
  }

  const entry: ToolEntry = {
    dir,
    manifest,
    files: files.sort(),
    content: existsSync(content) ? readFileSync(content, "utf8") : undefined,
    island: files.includes("island.astro")
      ? readFileSync(join(path, "island.astro"), "utf8")
      : undefined,
    sources,
  };
  return { entry, path, problems } satisfies LoadedTool;
}

/**
 * Reads a tool that is only being compared with, not checked: its manifest fields are read as text
 * and only its page is loaded. Falls back to a full load when the config is not plain literals.
 */
async function loadLight(root: string, category: string, id: string, label: string) {
  const path = join(root, category, id);
  const config = join(path, "tool.config.ts");
  const fields = existsSync(config) ? readManifestFields(readFileSync(config, "utf8")) : undefined;
  if (!fields) return loadTool(root, category, id, label);
  const content = join(path, "content", "en.mdx");
  const entry: ToolEntry = {
    dir: `${label}/${category}/${id}`,
    manifest: fields,
    // Not checked, so nothing to say about which files exist.
    files: [...REQUIRED_FILES],
    content: existsSync(content) ? readFileSync(content, "utf8") : undefined,
    island: ISLAND_SOURCE,
    sources: {},
  };
  return { entry, path, problems: [] } satisfies LoadedTool;
}

/**
 * Reads every tool folder under the root. With `focus` (a tool id), only that tool is read in full
 * (its manifest imported, every file read); the others are read as little as the comparing gates
 * need, which is what keeps `--tool` fast with hundreds of tools.
 */
export async function loadTools(
  root: string,
  label = "tools",
  options: { focus?: string | undefined } = {},
): Promise<LoadedTool[]> {
  return Promise.all(
    listToolFolders(root).map(([category, id]) =>
      options.focus === undefined || id === options.focus
        ? loadTool(root, category, id, label)
        : loadLight(root, category, id, label),
    ),
  );
}

/** The folder of a tool id, repo-relative, or undefined when no folder has that name. */
export function findToolDir(
  root: string,
  id: string,
  label = "tools",
): { dir: string; category: string } | undefined {
  const match = listToolFolders(root).find(([, name]) => name === id);
  return match ? { dir: `${label}/${match[0]}/${match[1]}`, category: match[0] } : undefined;
}

export const relativeToRepo = (path: string) => toPosix(relative(repoRoot, path));
