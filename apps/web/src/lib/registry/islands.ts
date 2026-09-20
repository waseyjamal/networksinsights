// Loads one tool's island. Imported by the tool page and by nothing else, so a listing page never
// pulls a tool's UI into its module graph (ADR 0033, zero-js.test.ts).
//
// The glob is lazy: it hands back a loader per tool, and only the page being rendered calls one.
// It points at island.astro rather than ui.tsx on purpose. Astro's compiler writes the hydration
// path only for a component it saw imported statically, so a route cannot mount a ui.tsx it looked
// up by id. island.astro holds that static import; Astro's build graph follows dynamic importers,
// so loading it here registers the island properly (ADR 0033).

import type { AstroComponentFactory } from "astro/runtime/server/index.js";
import { splitKey } from "./entries";

type IslandLoader = () => Promise<{ default: AstroComponentFactory }>;

const islands = import.meta.glob("../../../../../tools/*/*/island.astro") as Record<
  string,
  IslandLoader
>;

const byDir = new Map<string, IslandLoader>(
  Object.entries(islands).flatMap(([key, loader]) => {
    const split = splitKey(key, "tools", 2);
    return split ? [[split.dir, loader] as const] : [];
  }),
);

/** The island of the tool in `dir`, ready to render. Throws if the folder has none. */
export async function loadIsland(dir: string): Promise<AstroComponentFactory> {
  const loader = byDir.get(dir);
  if (!loader) throw new Error(`No island.astro for ${dir}`);
  return (await loader()).default;
}
