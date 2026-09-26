import { formatViolation, ToolContractError } from "@networksinsights/tool-sdk";
import { describe, expect, it } from "vitest";
import { buildRegistry } from "./build";
import { toEntries } from "./entries";
import { tools } from "./index";

// The registry, driven by real folders on disk through the same adapter the build uses.
//
// Each folder under fixtures/ is one case: fixtures/<case>/<category>/<tool-id>/. The production
// registry globs tools/*/*/, three levels shallower and in another folder entirely, so it can
// never pick these up. The last test in this file proves that.

const fixtures = {
  manifests: import.meta.glob("./fixtures/*/*/*/tool.config.ts", { eager: true }),
  files: import.meta.glob(
    [
      "./fixtures/*/*/*/tool.config.ts",
      "./fixtures/*/*/*/logic.ts",
      "./fixtures/*/*/*/logic.test.ts",
      "./fixtures/*/*/*/ui.tsx",
      "./fixtures/*/*/*/island.astro",
      "./fixtures/*/*/*/worker.ts",
      "./fixtures/*/*/*/content/en.mdx",
    ],
    { query: "?raw", import: "default" },
  ),
  islands: import.meta.glob("./fixtures/*/*/*/island.astro", {
    eager: true,
    query: "?raw",
    import: "default",
  }) as Record<string, string>,
  contents: import.meta.glob("./fixtures/*/*/*/content/en.mdx", {
    eager: true,
    query: "?raw",
    import: "default",
  }) as Record<string, string>,
};

const allEntries = toEntries(fixtures, "fixtures", 3);

/** The folders of one case. */
const set = (name: string) =>
  allEntries.filter((entry) => entry.dir.startsWith(`fixtures/${name}/`));

/** Every problem the build would print for one case, in full. */
function problems(name: string): string[] {
  try {
    buildRegistry(set(name));
    return [];
  } catch (error) {
    // The first line names the folder and the problem; the lines under it are the fix (tested below).
    if (error instanceof ToolContractError) {
      return error.violations.map((violation) => formatViolation(violation).split("\n")[0] ?? "");
    }
    throw error;
  }
}

describe("reading a tool folder", () => {
  it("finds every fixture folder and the files in it", () => {
    const valid = set("valid");
    expect(valid.map((entry) => entry.dir)).toEqual([
      "fixtures/valid/text/case-converter",
      "fixtures/valid/text/word-counter",
    ]);
    expect(valid[0]?.files).toEqual([
      "content/en.mdx",
      "island.astro",
      "logic.test.ts",
      "logic.ts",
      "tool.config.ts",
      "ui.tsx",
    ]);
    expect(valid[0]?.island).toContain("client:load");
    expect(valid[0]?.content).toContain("## How to use");
  });

  it("notices a missing file rather than inventing one", () => {
    expect(set("missing-test")[0]?.files).not.toContain("logic.test.ts");
  });
});

describe("a tool set that follows the contract", () => {
  const registry = buildRegistry(set("valid"));

  it("builds without complaint", () => {
    expect(problems("valid")).toEqual([]);
  });

  it("indexes tools by id, by category and by name", () => {
    expect(registry.all.map((tool) => tool.manifest.id)).toEqual([
      "case-converter",
      "word-counter",
    ]);
    expect(registry.byId.get("word-counter")?.manifest.name).toBe("Word counter");
    expect(registry.byCategory.get("text")).toHaveLength(2);
    expect(registry.byCategory.get("pdf")).toBeUndefined();
  });

  it("gives every tool a flat URL of its own id", () => {
    expect(registry.byId.get("word-counter")?.href).toBe("/word-counter/");
  });
});

describe("each rule the build enforces, and the folder that breaks it", () => {
  const cases: Array<[string, string]> = [
    [
      "missing-test",
      "Tool contract: fixtures/missing-test/text/word-counter — is missing the required file logic.test.ts",
    ],
    [
      "missing-island",
      "Tool contract: fixtures/missing-island/text/word-counter — is missing the required file island.astro",
    ],
    [
      "tampered-island",
      "Tool contract: fixtures/tampered-island/text/word-counter — island.astro must be the contract source, byte for byte: it is the glue that mounts ui.tsx, not a place for tool code",
    ],
    [
      "missing-section",
      'Tool contract: fixtures/missing-section/text/word-counter — content/en.mdx must have exactly the H2 sections "How to use", "Examples", "Limits", "FAQ" in that order, but has "How to use", "Examples", "Limits"',
    ],
    [
      "sections-out-of-order",
      'Tool contract: fixtures/sections-out-of-order/text/word-counter — content/en.mdx must have exactly the H2 sections "How to use", "Examples", "Limits", "FAQ" in that order, but has "Examples", "How to use", "Limits", "FAQ"',
    ],
    [
      "content-h1",
      "Tool contract: fixtures/content-h1/text/word-counter — content/en.mdx must not contain an H1: the page template renders the one H1, the tool name",
    ],
    [
      "no-intro",
      "Tool contract: fixtures/no-intro/text/word-counter — content/en.mdx must open with an intro paragraph, before the first H2",
    ],
    [
      "bad-id",
      "Tool contract: fixtures/bad-id/text/word-counter — manifest field `id`: id must be kebab-case (lowercase words joined by single hyphens)",
    ],
    [
      "id-folder-mismatch",
      'Tool contract: fixtures/id-folder-mismatch/text/word-counter — id is "word-count" but the folder is named "word-counter"; they must match, because the folder name is the URL',
    ],
    [
      "reserved-id",
      'Tool contract: fixtures/reserved-id/text/calculators — id "calculators" is a reserved path: it is already a category slug or a static page',
    ],
    [
      "category-folder-mismatch",
      'Tool contract: fixtures/category-folder-mismatch/pdf/word-counter — category is "text" but the folder sits in "pdf"; they must match',
    ],
    [
      "related-self",
      `Tool contract: fixtures/related-self/text/word-counter — related must not contain the tool's own id, "word-counter"`,
    ],
    [
      "related-missing",
      'Tool contract: fixtures/related-missing/text/word-counter — related tool "does-not-exist" does not exist',
    ],
    [
      "dates-backwards",
      "Tool contract: fixtures/dates-backwards/text/word-counter — updated (2026-09-19) is earlier than added (2026-09-20)",
    ],
    [
      "no-default-export",
      "Tool contract: fixtures/no-default-export/text/word-counter — tool.config.ts must have a default export: `export default defineTool({ ... })`",
    ],
  ];

  for (const [name, message] of cases) {
    it(`${name}: says exactly what is wrong and in which folder`, () => {
      expect(problems(name)).toEqual([message]);
    });
  }

  it("unknown-category: lists the categories that do exist", () => {
    const [message, ...rest] = problems("unknown-category");
    expect(rest).toEqual([]);
    expect(message).toContain(
      'fixtures/unknown-category/gadgets/word-counter — category "gadgets" is not in the categories config',
    );
    expect(message).toContain("expected one of: pdf, image, video-audio, text");
  });

  it("duplicate-id: complains in both folders, naming the other", () => {
    expect(problems("duplicate-id")).toEqual([
      'Tool contract: fixtures/duplicate-id/pdf/word-counter — id "word-counter" is also used by fixtures/duplicate-id/text/word-counter',
      'Tool contract: fixtures/duplicate-id/text/word-counter — id "word-counter" is also used by fixtures/duplicate-id/pdf/word-counter',
    ]);
  });

  it("duplicate-summary: complains in both folders, because a summary is a meta description", () => {
    const found = problems("duplicate-summary");
    expect(found).toHaveLength(2);
    expect(found[0]).toContain(
      "fixtures/duplicate-summary/text/case-converter — summary is the same as the summary of fixtures/duplicate-summary/text/word-counter",
    );
  });
});

describe("every problem says where to look and what to change", () => {
  it("prints the file path and a fix under the first line", () => {
    try {
      buildRegistry(set("tampered-island"));
      expect.unreachable("the tampered island must fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolContractError);
      const message = (error as Error).message;
      expect(message).toContain("File:    fixtures/tampered-island/text/word-counter/island.astro");
      expect(message).toContain("Fix:     restore the file to the contract source");
    }
  });

  it("gives every violation of every fixture a file or a fix", () => {
    for (const name of new Set(allEntries.map((entry) => entry.dir.split("/")[1]))) {
      if (name === "valid" || name === undefined) continue;
      try {
        buildRegistry(set(name));
      } catch (error) {
        for (const violation of (error as ToolContractError).violations) {
          expect(violation.fix, `${name}: ${violation.problem}`).toBeTruthy();
        }
      }
    }
  });
});

describe("the fixtures are invisible to the production registry", () => {
  it("finds the real tools, and every tool it finds comes from tools/", () => {
    expect(tools.map((tool) => tool.manifest.id)).toContain("word-counter");
    for (const tool of tools) expect(tool.dir.startsWith("tools/")).toBe(true);
  });

  it("globs a different folder and a different depth from the fixtures", () => {
    for (const entry of allEntries) {
      expect(entry.dir.startsWith("fixtures/")).toBe(true);
      expect(entry.dir.split("/")).toHaveLength(4);
    }
  });
});
