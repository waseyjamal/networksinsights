// The production tool registry: every folder under tools/, discovered at build time (ADR 0033).
//
// Metadata only. No tool UI, no MDX component, nothing that could put JavaScript on a listing
// page — see the comment in build.ts and zero-js.test.ts.
//
// There are no tools yet. Every glob below is empty, every count is zero, and the site keeps its
// honest "Coming soon" states. The first tool arrives in Mission 13.

import type { ContractViolation } from "@networksinsights/tool-sdk";
import { buildRegistry, type Registry, type Tool } from "./build";
import { toEntries } from "./entries";
import { adviseQuality, enforceQuality, qualityMode } from "./quality";

// Paths are relative to this file: five levels up is the repo root, where tools/ lives.
// ?raw on island.astro and content/en.mdx is deliberate: it is excluded from the Astro and MDX
// transforms, so the validator sees the file as written, not a compiled component.
const globs = {
  manifests: import.meta.glob("../../../../../tools/*/*/tool.config.ts", { eager: true }),
  files: import.meta.glob(
    [
      "../../../../../tools/*/*/tool.config.ts",
      "../../../../../tools/*/*/logic.ts",
      "../../../../../tools/*/*/logic.test.ts",
      "../../../../../tools/*/*/ui.tsx",
      "../../../../../tools/*/*/island.astro",
      "../../../../../tools/*/*/worker.ts",
      "../../../../../tools/*/*/content/en.mdx",
    ],
    { query: "?raw", import: "default" },
  ),
  sources: import.meta.glob(
    [
      "../../../../../tools/*/*/logic.ts",
      "../../../../../tools/*/*/ui.tsx",
      "../../../../../tools/*/*/logic.test.ts",
      "../../../../../tools/*/*/worker.ts",
    ],
    { eager: true, query: "?raw", import: "default" },
  ) as Record<string, string>,
  islands: import.meta.glob("../../../../../tools/*/*/island.astro", {
    eager: true,
    query: "?raw",
    import: "default",
  }) as Record<string, string>,
  contents: import.meta.glob("../../../../../tools/*/*/content/en.mdx", {
    eager: true,
    query: "?raw",
    import: "default",
  }) as Record<string, string>,
};

const entries = toEntries(globs, "tools", 2);

/** The validated tool set. Building it throws ToolContractError if a folder breaks the contract. */
export const registry: Registry = buildRegistry(entries);

/**
 * Content quality problems (ADR 0036). Empty in a production build, which throws instead. In
 * `astro dev` they are printed as a warning and the pages still render, so a tool that is being
 * written does not block the owner.
 */
export const qualityProblems: readonly ContractViolation[] = enforceQuality(
  entries,
  qualityMode(import.meta.env.DEV),
);

/** Advice from the gates that only warn (ADR 0044). Printed once, never a failure. */
export const qualityAdvice: readonly ContractViolation[] = adviseQuality(entries);

/** Every tool, by name. */
export const tools: readonly Tool[] = registry.all;

export function getTool(id: string): Tool | undefined {
  return registry.byId.get(id);
}

export function toolsInCategory(categoryId: string): readonly Tool[] {
  return registry.byCategory.get(categoryId) ?? [];
}

/** How many tools a category has. Zero is a real answer, and the tile says "Coming soon". */
export function toolCount(categoryId: string): number {
  return toolsInCategory(categoryId).length;
}

export type { Registry, Tool } from "./build";
export { toolHref } from "./build";
