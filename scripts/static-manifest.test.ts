import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { generateTool } from "./lib/generate";
import { readManifestFields } from "./lib/static-manifest";
import { inputFor, scratchRoot } from "./lib/test-support";
import { loadTool } from "./lib/tools";

// The reader that keeps `--tool` fast must never disagree with a real import. It only reads the
// plain shape the generator writes and Biome keeps, and gives up (undefined) on anything else.

const roots: Array<ReturnType<typeof scratchRoot>> = [];
afterEach(() => {
  for (const scratch of roots.splice(0)) scratch.remove();
});

describe("reading a manifest as text", () => {
  it("agrees with a real import, for a long summary that wraps and for many tags", async () => {
    const scratch = scratchRoot();
    roots.push(scratch);
    const long =
      "Turn a JPG picture into a lossless PNG file, right in your browser, with nothing uploaded and nothing kept.";
    await generateTool(
      inputFor("jpg-to-png", {
        category: "image",
        name: 'JPG to PNG "converter"',
        summary: long,
        tags: ["images", "jpg", "png", "convert", "lossless", "browser", "privacy", "pictures"],
      }),
      { toolsRoot: scratch.tools, today: "2026-09-21" },
    );

    const { entry, path } = await loadTool(scratch.tools, "image", "jpg-to-png");
    const text = readFileSync(`${path}/tool.config.ts`, "utf8");
    const read = readManifestFields(text);
    const real = entry.manifest as Record<string, unknown>;
    for (const key of [
      "id",
      "name",
      "category",
      "summary",
      "tags",
      "runtime",
      "status",
      "related",
      "added",
      "updated",
    ]) {
      expect(read?.[key], key).toEqual(real[key]);
    }
  });

  it("gives up rather than guess when the manifest is not plain literals", () => {
    const computed = `import { defineTool } from "@networksinsights/tool-sdk";
const NAME = "Word counter";
export default defineTool({
  id: "word-counter",
  name: NAME,
  category: "text",
  summary: "Count the words in any text as you type.",
});
`;
    expect(readManifestFields(computed)).toBeUndefined();
    expect(readManifestFields("export const x = 1;")).toBeUndefined();
    expect(
      readManifestFields('export default defineTool({\n  id: "a",\n  id: "b",\n});'),
    ).toBeUndefined();
  });
});
