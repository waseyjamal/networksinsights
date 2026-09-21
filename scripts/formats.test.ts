import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GeneratorError, generateTool, parseFormats, validateInput } from "./lib/generate";
import { inputFor, scratchRoot } from "./lib/test-support";
import { loadTool } from "./lib/tools";

// `--accepts` and `--produces` of `pnpm new:tool` (ADR 0044): optional file formats for the
// "Quick facts" of a tool page, written into the manifest only when they are given.

const roots: Array<ReturnType<typeof scratchRoot>> = [];
afterEach(() => {
  for (const scratch of roots.splice(0)) scratch.remove();
});
const fresh = () => {
  const scratch = scratchRoot();
  roots.push(scratch);
  return scratch;
};
const today = "2026-09-21";

describe("parseFormats", () => {
  it("splits on commas, trims, and keeps capitals", () => {
    expect(parseFormats("PDF, PNG ,WebP")).toEqual(["PDF", "PNG", "WebP"]);
    expect(parseFormats("")).toEqual([]);
    expect(parseFormats(" , ,")).toEqual([]);
  });
});

describe("validateInput", () => {
  it("accepts good formats and names the flag of a bad one", () => {
    expect(validateInput(inputFor("png-to-jpg", { accepts: ["PNG"], produces: ["JPG"] }))).toEqual(
      [],
    );
    const problems = validateInput(inputFor("png-to-jpg", { accepts: ["not a <format>"] }));
    expect(problems.join()).toContain("--accepts");
    expect(problems.join()).toContain("Example: --accepts PDF,PNG");
  });

  it("refuses a repeated format", () => {
    expect(validateInput(inputFor("png-to-jpg", { produces: ["JPG", "jpg"] })).join()).toContain(
      "--produces",
    );
  });
});

describe("the generated manifest", () => {
  it("has no accepts or produces unless they are given", async () => {
    const { tools } = fresh();
    const result = await generateTool(inputFor("word-counter"), { toolsRoot: tools, today });
    const config = readFileSync(join(result.path, "tool.config.ts"), "utf8");
    expect(config).not.toContain("accepts");
    expect(config).not.toContain("produces");
  });

  it("writes them, in the manifest's own style, when they are given", async () => {
    const { tools } = fresh();
    const result = await generateTool(
      inputFor("png-to-jpg", { category: "image", accepts: ["PNG"], produces: ["JPG", "WebP"] }),
      { toolsRoot: tools, today },
    );
    const config = readFileSync(join(result.path, "tool.config.ts"), "utf8");
    expect(config).toContain('  accepts: ["PNG"],\n');
    expect(config).toContain('  produces: ["JPG", "WebP"],\n');
    // And the manifest that was written is the one the platform reads back.
    const loaded = await loadTool(tools, "image", "png-to-jpg");
    expect(loaded.problems).toEqual([]);
    expect(loaded.entry.manifest).toMatchObject({ accepts: ["PNG"], produces: ["JPG", "WebP"] });
  });

  it("refuses a bad format before writing anything", async () => {
    const { tools } = fresh();
    await expect(
      generateTool(inputFor("png-to-jpg", { accepts: ["<b>PNG</b>"] }), {
        toolsRoot: tools,
        today,
      }),
    ).rejects.toBeInstanceOf(GeneratorError);
  });

  it("puts the answer-first advice in the content stub", async () => {
    const { tools } = fresh();
    const result = await generateTool(inputFor("word-counter"), { toolsRoot: tools, today });
    const content = readFileSync(join(result.path, "content", "en.mdx"), "utf8");
    expect(content).toContain("first sentence says what the tool does");
    expect(content).toContain("at most 30 words");
  });
});
