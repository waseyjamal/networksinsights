import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ISLAND_SOURCE, REQUIRED_FILES } from "./files";
import type { ToolManifest } from "./types";
import { formatViolation, ToolContractError, type ToolEntry, validateTools } from "./validate";

const options = {
  categoryIds: ["text", "pdf", "calculators"],
  reservedPaths: ["text-tools", "calculators", "about", "tools"],
};

const content = `An intro paragraph.

## How to use

Words.

## Examples

Words.

## Limits

Words.

## FAQ

Words.
`;

function manifest(overrides: Partial<ToolManifest> = {}): ToolManifest {
  return {
    id: "word-counter",
    name: "Word counter",
    category: "text",
    summary: "Count the words, characters and lines in any text, as you type.",
    tags: ["words"],
    runtime: "client",
    status: "beta",
    input: z.object({ text: z.string() }),
    related: [],
    added: "2026-09-20",
    updated: "2026-09-20",
    ...overrides,
  };
}

function entry(overrides: Partial<ToolEntry> = {}): ToolEntry {
  return {
    dir: "tools/text/word-counter",
    manifest: manifest(),
    files: [...REQUIRED_FILES],
    content,
    island: ISLAND_SOURCE,
    ...overrides,
  };
}

/** The problems of the first (or only) folder, as plain sentences. */
const problems = (...entries: ToolEntry[]) =>
  validateTools(entries, options).map((violation) => violation.problem);

describe("validateTools: a folder that follows the contract", () => {
  it("reports nothing", () => {
    expect(validateTools([entry()], options)).toEqual([]);
  });

  it("reports nothing for an empty tool set, which is what the site ships today", () => {
    expect(validateTools([], options)).toEqual([]);
  });
});

describe("validateTools: the manifest", () => {
  it("names the field and the rule when the schema fails", () => {
    expect(problems(entry({ manifest: manifest({ id: "Word Counter" }) })).join()).toContain(
      "manifest field `id`: id must be kebab-case",
    );
  });

  it("asks for a default export when there is none", () => {
    expect(problems(entry({ manifest: undefined }))).toEqual([
      "tool.config.ts must have a default export: `export default defineTool({ ... })`",
    ]);
  });

  it("requires the id to match the folder name, because the folder name is the URL", () => {
    const wrong = entry({ manifest: manifest({ id: "word-count" }) });
    expect(problems(wrong).join()).toContain(
      'id is "word-count" but the folder is named "word-counter"',
    );
  });

  it("requires the category to match the parent folder", () => {
    const wrong = entry({ manifest: manifest({ category: "pdf" }) });
    expect(problems(wrong).join()).toContain('category is "pdf" but the folder sits in "text"');
  });

  it("refuses an id that is a reserved path", () => {
    const wrong = entry({
      dir: "tools/text/calculators",
      manifest: manifest({ id: "calculators" }),
    });
    expect(problems(wrong).join()).toContain('id "calculators" is a reserved path');
  });

  it("refuses a category that is not in the categories config", () => {
    const wrong = entry({
      dir: "tools/gadgets/word-counter",
      manifest: manifest({ category: "gadgets" }),
    });
    expect(problems(wrong).join()).toContain('category "gadgets" is not in the categories config');
  });

  it("refuses a tool that lists itself as related", () => {
    const wrong = entry({ manifest: manifest({ related: ["word-counter"] }) });
    expect(problems(wrong).join()).toContain("related must not contain the tool's own id");
  });

  it("refuses an update date earlier than the added date", () => {
    const wrong = entry({ manifest: manifest({ added: "2026-09-20", updated: "2026-09-19" }) });
    expect(problems(wrong).join()).toContain("updated (2026-09-19) is earlier than added");
  });
});

describe("validateTools: the files", () => {
  for (const missing of REQUIRED_FILES) {
    it(`refuses a folder without ${missing}`, () => {
      const files = REQUIRED_FILES.filter((file) => file !== missing);
      expect(problems(entry({ files }))).toContain(`is missing the required file ${missing}`);
    });
  }

  it("refuses an island.astro that is not the contract source", () => {
    const tampered = entry({
      island: '---\nimport Ui from "./ui.tsx";\n---\n<Ui client:idle />\n',
    });
    expect(problems(tampered).join()).toContain("island.astro must be the contract source");
  });

  it("accepts an island.astro with Windows line endings", () => {
    expect(problems(entry({ island: ISLAND_SOURCE.replaceAll("\n", "\r\n") }))).toEqual([]);
  });

  it("reports the content problems of content/en.mdx", () => {
    expect(problems(entry({ content: "No sections here." })).join()).toContain(
      "must have exactly the H2 sections",
    );
  });
});

describe("validateTools: rules that need the whole set", () => {
  const second = entry({
    dir: "tools/text/case-converter",
    manifest: manifest({
      id: "case-converter",
      name: "Case converter",
      summary: "Switch text between upper case, lower case, title case and sentence case.",
    }),
  });

  it("accepts two different tools", () => {
    expect(validateTools([entry(), second], options)).toEqual([]);
  });

  it("refuses two tools with the same id, naming the other folder", () => {
    const clash = entry({
      dir: "tools/pdf/word-counter",
      manifest: manifest({
        category: "pdf",
        summary: "Count the words in a PDF without opening it in a reader.",
      }),
    });
    const found = validateTools([entry(), clash], options);
    expect(found.map((violation) => violation.dir)).toEqual([
      "tools/pdf/word-counter",
      "tools/text/word-counter",
    ]);
    expect(found[0]?.problem).toBe('id "word-counter" is also used by tools/text/word-counter');
  });

  it("refuses two tools with the same summary, because it is the meta description", () => {
    const copy = entry({
      dir: "tools/text/case-converter",
      manifest: manifest({ id: "case-converter", name: "Case converter" }),
    });
    expect(problems(entry(), copy).join()).toContain("summary is the same as the summary of");
  });

  it("compares summaries ignoring case and surrounding space", () => {
    const copy = entry({
      dir: "tools/text/case-converter",
      manifest: manifest({
        id: "case-converter",
        name: "Case converter",
        summary: "  COUNT THE WORDS, CHARACTERS AND LINES IN ANY TEXT, AS YOU TYPE.  ",
      }),
    });
    expect(problems(entry(), copy).join()).toContain("summary is the same as the summary of");
  });

  it("refuses a related id that no tool has", () => {
    const wrong = entry({ manifest: manifest({ related: ["does-not-exist"] }) });
    expect(problems(wrong)).toContain('related tool "does-not-exist" does not exist');
  });

  it("accepts a related id that another tool has", () => {
    const linked = entry({ manifest: manifest({ related: ["case-converter"] }) });
    expect(validateTools([linked, second], options)).toEqual([]);
  });

  it("returns problems in folder order", () => {
    const first = entry({ dir: "tools/a/one", manifest: manifest({ id: "one", category: "a" }) });
    const later = entry({ dir: "tools/z/two", manifest: manifest({ id: "two", category: "z" }) });
    const dirs = validateTools([later, first], options).map((violation) => violation.dir);
    expect(dirs).toEqual([...dirs].sort());
  });
});

describe("the error the build shows", () => {
  it("writes one line per problem, naming the folder and the problem", () => {
    expect(formatViolation({ dir: "tools/text/x", problem: "is missing ui.tsx" })).toBe(
      "Tool contract: tools/text/x — is missing ui.tsx",
    );
  });

  it("lists every problem, not only the first", () => {
    const error = new ToolContractError([
      { dir: "tools/text/x", problem: "is missing ui.tsx" },
      { dir: "tools/text/y", problem: "is missing logic.ts" },
    ]);
    expect(error.message).toContain("2 tool contract problems:");
    expect(error.message).toContain("Tool contract: tools/text/x — is missing ui.tsx");
    expect(error.message).toContain("Tool contract: tools/text/y — is missing logic.ts");
    expect(error.violations).toHaveLength(2);
  });
});
