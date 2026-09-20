// Turns bundler globs into the ToolEntry list the SDK validates.
//
// The production registry and the fixture tests use this same adapter, so the tests exercise the
// code the build runs, not a copy of it.

import type { ToolEntry } from "@networksinsights/tool-sdk";

/** The four globs a tool set is read from. Keys are paths; only the last two hold file contents. */
export interface ToolGlobs {
  /**
   * `<dir>/tool.config.ts` → the whole module. Eager: manifests are metadata.
   *
   * The module, not its default export: a glob with `import: "default"` fails at bundle time
   * when a file has no default export, and the contract would rather say so itself.
   */
  manifests: Record<string, unknown>;
  /** Every required and optional file that exists. Lazy: the keys are the whole point. */
  files: Record<string, unknown>;
  /** `<dir>/island.astro` → its source text. */
  islands: Record<string, string>;
  /** `<dir>/content/en.mdx` → its source text. */
  contents: Record<string, string>;
}

/**
 * Cuts a glob key into the tool folder and the file inside it.
 *
 * `../../../../../tools/text/word-counter/content/en.mdx` with root `tools` and depth 2
 * becomes `{ dir: "tools/text/word-counter", file: "content/en.mdx" }`.
 *
 * `depth` is how many segments after the root make up the folder: two in production
 * (category, tool), three for fixtures, which group each case in a folder of its own.
 */
export function splitKey(
  key: string,
  root: string,
  depth: number,
): { dir: string; file: string } | null {
  const normalized = key.replaceAll("\\", "/");
  const start = normalized.lastIndexOf(`/${root}/`);
  const path = start === -1 ? normalized.replace(/^\.\//, "") : normalized.slice(start + 1);
  if (!path.startsWith(`${root}/`)) return null;

  const parts = path.split("/");
  const dir = parts.slice(0, depth + 1).join("/");
  const file = parts.slice(depth + 1).join("/");
  return file ? { dir, file } : null;
}

/** Builds one entry per tool folder found in the globs, in folder order. */
export function toEntries(globs: ToolGlobs, root: string, depth: number): ToolEntry[] {
  const files = new Map<string, string[]>();
  const add = (key: string) => {
    const split = splitKey(key, root, depth);
    if (!split) return;
    files.set(split.dir, [...(files.get(split.dir) ?? []), split.file]);
  };
  for (const key of Object.keys(globs.files)) add(key);
  // A folder with a manifest and nothing else is still a folder, and must say so.
  for (const key of Object.keys(globs.manifests)) {
    if (!files.has(splitKey(key, root, depth)?.dir ?? "")) add(key);
  }

  const byDir = <T>(record: Record<string, T>) =>
    new Map(
      Object.entries(record).flatMap(([key, value]) => {
        const split = splitKey(key, root, depth);
        return split ? [[split.dir, value] as const] : [];
      }),
    );
  const manifests = byDir(globs.manifests);
  const islands = byDir(globs.islands);
  const contents = byDir(globs.contents);

  return [...files.keys()].sort().map((dir) => ({
    dir,
    manifest: (manifests.get(dir) as { default?: unknown } | undefined)?.default,
    files: [...new Set(files.get(dir) ?? [])].sort(),
    content: contents.get(dir),
    island: islands.get(dir),
  }));
}
