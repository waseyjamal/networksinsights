// The files a tool folder must and may contain, and the exact source of island.astro.

/** Every file a tool folder must have. The build fails if one is missing (ADR 0033). */
export const REQUIRED_FILES = [
  "tool.config.ts",
  "logic.ts",
  "ui.tsx",
  "island.astro",
  "content/en.mdx",
  "logic.test.ts",
] as const;

/** Files a tool may add. `worker.ts` is the Web Worker of a `worker` tool (ADR 0051). */
export const OPTIONAL_FILES = ["worker.ts"] as const;

/**
 * The entire contents of every tool's `island.astro`, byte for byte.
 *
 * It exists because Astro cannot hydrate a component it did not see imported: the compiler emits
 * `client:component-path` only for a static import, so a route that looks a `ui.tsx` up by tool id
 * cannot mount it. A dynamically imported `.astro` module whose own import is static works,
 * because Astro's build graph follows dynamic importers. This file is that module (ADR 0033).
 *
 * It is glue, not a place for tool code, so the validator compares it byte for byte and Mission 9's
 * generator writes it. Changing the hydration strategy means changing this constant once.
 */
export const ISLAND_SOURCE = `---
import Ui from "./ui.tsx";
---

<Ui client:load />
`;

/** Line endings differ between a Windows checkout and CI, and mean nothing here. */
export function normalizeSource(source: string): string {
  return source.replaceAll("\r\n", "\n");
}
