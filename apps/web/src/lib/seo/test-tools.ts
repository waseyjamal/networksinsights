// Tools made up for the SEO tests. There are no real tools until Mission 13, and these tests must
// keep working after them, so they build their own: same shape as the registry's, no files.

import type { ToolManifest } from "@networksinsights/tool-sdk";
import { z } from "zod";
import type { Tool } from "../registry/build";

export function toolOf(
  id: string,
  category = "text",
  updated = "2026-09-20",
  overrides: Partial<ToolManifest> = {},
): Tool {
  const name = id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  const manifest: ToolManifest = {
    id,
    name,
    category,
    summary: `Does one small job for ${name}, as you type.`,
    tags: ["test"],
    runtime: "client",
    status: "stable",
    input: z.object({ text: z.string() }),
    related: [],
    added: "2026-09-01",
    updated,
    ...overrides,
  };
  return {
    manifest,
    dir: `tools/${category}/${id}`,
    href: `/${id}/`,
    faq: [
      { question: `What is ${name}?`, answer: `${name} is a small tool.` },
      { question: `Is ${name} free?`, answer: "Yes. Every tool on the site is free." },
    ],
  };
}

/** `count` distinct tools spread over the categories, for scale tests. */
export function manyTools(count: number, categories: readonly string[]): Tool[] {
  return Array.from({ length: count }, (_, index) =>
    toolOf(
      `tool-${index + 1}`,
      categories[index % categories.length],
      `2026-09-${String((index % 28) + 1).padStart(2, "0")}`,
    ),
  );
}
