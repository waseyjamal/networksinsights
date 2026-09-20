// Reads the gate fixtures from disk for the tests: fixtures/gates/<gate>/<pass|fail>/<tool-id>/.
//
// Each fixture tool is a folder with a `manifest.json`, an optional `content/en.mdx` and an
// optional `logic.ts`. A manifest may say `contentFrom` to reuse one of the shared pages in
// fixtures/pages/, so a passing case does not need its own copy of a good page.

import { z } from "zod";
import { ISLAND_SOURCE, REQUIRED_FILES } from "../files";
import type { ToolEntry } from "../validate";

const manifests = import.meta.glob<Record<string, unknown>>(
  "./fixtures/gates/*/*/*/manifest.json",
  { eager: true, import: "default" },
);
const contents = import.meta.glob<string>("./fixtures/gates/*/*/*/content/en.mdx", {
  eager: true,
  query: "?raw",
  import: "default",
});
const logics = import.meta.glob<string>("./fixtures/gates/*/*/*/logic.ts", {
  eager: true,
  query: "?raw",
  import: "default",
});
const pages = import.meta.glob<string>("./fixtures/pages/*.mdx", {
  eager: true,
  query: "?raw",
  import: "default",
});

/** The shared good pages, by name: `word-counter` → its MDX. */
export const pageSources: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(pages).map(([path, source]) => [
    path.replace("./fixtures/pages/", "").replace(".mdx", ""),
    source,
  ]),
);

export type FixtureKind = "pass" | "fail";

function entryFor(path: string, manifest: Record<string, unknown>): ToolEntry {
  const dir = path.replace("./fixtures/", "").replace("/manifest.json", "");
  const folder = path.replace("/manifest.json", "");
  const { contentFrom, ...rest } = manifest as { contentFrom?: string } & Record<string, unknown>;
  const content = contentFrom
    ? pages[`./fixtures/${contentFrom}`]
    : contents[`${folder}/content/en.mdx`];
  const logic = logics[`${folder}/logic.ts`];
  return {
    dir: `fixtures/${dir}`,
    manifest: { ...rest, input: z.object({}) },
    files: [...REQUIRED_FILES],
    content,
    island: ISLAND_SOURCE,
    sources: logic === undefined ? {} : { "logic.ts": logic },
  };
}

/** The tool folders of one fixture case, in folder order. */
export function fixtureEntries(gate: string, kind: FixtureKind): ToolEntry[] {
  return Object.entries(manifests)
    .filter(([path]) => path.startsWith(`./fixtures/gates/${gate}/${kind}/`))
    .map(([path, manifest]) => entryFor(path, manifest))
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

/** Every gate id that has a fixtures folder. */
export function fixtureGates(): string[] {
  return [...new Set(Object.keys(manifests).map((path) => path.split("/")[3] ?? ""))].sort();
}
