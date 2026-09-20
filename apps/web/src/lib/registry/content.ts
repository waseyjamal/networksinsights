// Loads one tool's page content. Imported by the tool page and by nothing else, for the same
// reason as islands.ts: MDX can hold islands, and a listing page must never reach it.

import type { AstroComponentFactory } from "astro/runtime/server/index.js";
import { splitKey } from "./entries";

type ContentLoader = () => Promise<{ Content: AstroComponentFactory }>;

const contents = import.meta.glob("../../../../../tools/*/*/content/en.mdx") as Record<
  string,
  ContentLoader
>;

const byDir = new Map<string, ContentLoader>(
  Object.entries(contents).flatMap(([key, loader]) => {
    const split = splitKey(key, "tools", 2);
    return split ? [[split.dir, loader] as const] : [];
  }),
);

/** The rendered content of the tool in `dir`. Throws if the folder has none. */
export async function loadContent(dir: string): Promise<AstroComponentFactory> {
  const loader = byDir.get(dir);
  if (!loader) throw new Error(`No content/en.mdx for ${dir}`);
  return (await loader()).Content;
}
