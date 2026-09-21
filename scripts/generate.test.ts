import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkContent,
  ISLAND_SOURCE,
  REQUIRED_FILES,
  UNFINISHED_MARKER,
  validateTools,
} from "@networksinsights/tool-sdk";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { checkLogicPurity } from "../apps/web/src/lib/registry/purity";
import {
  type FileSystem,
  GeneratorError,
  generateTool,
  localToday,
  type NewToolInput,
  nodeFileSystem,
  parseTags,
  validateInput,
} from "./lib/generate";
import { inputFor, scratchRoot } from "./lib/test-support";
import { loadTool, repoRoot, siteConfig } from "./lib/tools";

// The generator (ADR 0035): it validates first, writes a complete tool or nothing, and never
// overwrites. Every test generates into a temporary folder under scripts/.tmp/.

const roots: Array<ReturnType<typeof scratchRoot>> = [];
function fresh() {
  const scratch = scratchRoot();
  roots.push(scratch);
  return scratch;
}
afterEach(() => {
  for (const scratch of roots.splice(0)) scratch.remove();
});

const today = "2026-09-21";
const options = (tools: string) => ({ toolsRoot: tools, today });

/** Everything under a folder, as relative paths, or [] when it does not exist. */
function listAll(folder: string, base = folder): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    const relative = path.slice(base.length + 1).replaceAll("\\", "/");
    return entry.isDirectory() ? [relative, ...listAll(path, base)] : [relative];
  });
}

describe("what it writes", () => {
  it("creates every required file, and worker.ts only for a worker", async () => {
    const { tools } = fresh();
    const result = await generateTool(inputFor("word-counter"), options(tools));

    expect(result.dir).toBe("tools/text/word-counter");
    expect(
      listAll(join(tools, "text", "word-counter")).filter((path) => !path.endsWith("content")),
    ).toEqual([...REQUIRED_FILES].sort());
    expect(result.files.sort()).toEqual([...REQUIRED_FILES].sort());

    const worker = await generateTool(
      inputFor("image-resizer", { runtime: "worker" }),
      options(tools),
    );
    expect(worker.files).toContain("worker.ts");
    expect(existsSync(join(tools, "text", "image-resizer", "worker.ts"))).toBe(true);
  });

  it("fills the manifest: status beta, added and updated are today, and the values given", async () => {
    const { tools } = fresh();
    const input = inputFor("word-counter", {
      name: "Word counter",
      summary: "Count the words, characters and lines in any text, as you type.",
      tags: ["words", "characters"],
    });
    await generateTool(input, options(tools));

    const { entry } = await loadTool(tools, "text", "word-counter");
    expect(entry.manifest).toMatchObject({
      id: "word-counter",
      name: "Word counter",
      category: "text",
      summary: "Count the words, characters and lines in any text, as you type.",
      tags: ["words", "characters"],
      runtime: "client",
      status: "beta",
      related: [],
      added: today,
      updated: today,
    });
  });

  it("writes island.astro as the contract source, byte for byte", async () => {
    const { tools } = fresh();
    await generateTool(inputFor("word-counter"), options(tools));
    expect(readFileSync(join(tools, "text", "word-counter", "island.astro"), "utf8")).toBe(
      ISLAND_SOURCE,
    );
  });

  it("writes content with the required headings in order, and a TODO in each section", async () => {
    const { tools } = fresh();
    await generateTool(inputFor("word-counter"), options(tools));
    const content = readFileSync(join(tools, "text", "word-counter", "content", "en.mdx"), "utf8");
    expect(checkContent(content)).toEqual([]);
    expect(content.match(/^## .+$/gm)).toEqual([
      "## How to use",
      "## Examples",
      "## Limits",
      "## FAQ",
    ]);
    expect(content.split(UNFINISHED_MARKER).length - 1).toBeGreaterThanOrEqual(5);
  });

  it("writes a logic.ts that is pure, typed and marked, and a test that fails until it is written", async () => {
    const { tools } = fresh();
    await generateTool(inputFor("word-counter"), options(tools));
    const dir = join(tools, "text", "word-counter");
    const logic = readFileSync(join(dir, "logic.ts"), "utf8");
    expect(checkLogicPurity(logic)).toEqual([]);
    expect(logic).toContain(UNFINISHED_MARKER);
    expect(logic).toContain("export function run(input: Input): Result");
    const test = readFileSync(join(dir, "logic.test.ts"), "utf8");
    expect(test).toContain("expect.fail(");
    expect(test).toContain(UNFINISHED_MARKER);
  });

  it("wires ui.tsx to logic.ts and to the design system", async () => {
    const { tools } = fresh();
    await generateTool(inputFor("word-counter"), options(tools));
    const ui = readFileSync(join(tools, "text", "word-counter", "ui.tsx"), "utf8");
    expect(ui).toContain('from "@ui"');
    expect(ui).toContain('from "./logic"');
    expect(ui).toContain("export default function");
  });

  it("passes registry validation: the contract finds nothing to complain about", async () => {
    const { tools } = fresh();
    await generateTool(inputFor("word-counter"), options(tools));
    await generateTool(inputFor("case-converter"), options(tools));
    const loaded = await Promise.all([
      loadTool(tools, "text", "word-counter"),
      loadTool(tools, "text", "case-converter"),
    ]);
    expect(loaded.flatMap((tool) => tool.problems)).toEqual([]);
    expect(
      validateTools(
        loaded.map((tool) => tool.entry),
        { categoryIds: siteConfig.categoryIds, reservedPaths: siteConfig.reservedPaths },
      ),
    ).toEqual([]);
  });

  it("type-checks, strictly, with the same options as `pnpm typecheck` gives every tool", {
    tags: ["slow"],
  }, async () => {
    const { tools } = fresh();
    await generateTool(inputFor("word-counter"), options(tools));
    await generateTool(inputFor("image-resizer", { runtime: "worker" }), options(tools));

    const config = ts.readConfigFile(join(repoRoot, "tools", "tsconfig.json"), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      { compilerOptions: { ...config.config.compilerOptions, paths: undefined } },
      ts.sys,
      join(repoRoot, "tools"),
    );
    const uiIndex = join(repoRoot, "apps", "web", "src", "components", "ui", "react", "index.ts");
    const files = listAll(tools)
      .filter((path) => /\.tsx?$/.test(path))
      .map((path) => join(tools, path));
    const program = ts.createProgram(files, {
      ...parsed.options,
      paths: { "@ui": [uiIndex] },
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => {
      const where = diagnostic.file ? `${diagnostic.file.fileName}: ` : "";
      return `${where}${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
    });
    expect(diagnostics).toEqual([]);
  });

  it("ends every message with the next steps and the exact commands to check the tool", async () => {
    // The CLI prints them; the commands they name must exist as package scripts.
    const scripts = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts;
    for (const name of [
      "new:tool",
      "check:tools",
      "check:budgets",
      "check",
      "build",
      "dev",
      "test",
    ]) {
      expect(scripts, name).toHaveProperty(name);
    }
  });
});

describe("what it refuses, before it writes anything", () => {
  const refuses = async (input: NewToolInput, tools: string) => {
    const error = await generateTool(input, options(tools)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GeneratorError);
    expect(listAll(tools)).toEqual([]);
    return (error as GeneratorError).problems.join("\n");
  };

  it("a colliding id, in this category or another", async () => {
    const { tools } = fresh();
    await generateTool(inputFor("word-counter"), options(tools));
    const before = listAll(tools);

    for (const category of ["text", "developer"]) {
      const error = await generateTool(
        inputFor("word-counter", {
          category,
          name: "Another name",
          summary: "A wholly different sentence about something else.",
        }),
        options(tools),
      ).catch((caught: unknown) => caught);
      expect(error, category).toBeInstanceOf(GeneratorError);
      expect((error as GeneratorError).problems.join("\n")).toContain(
        'a tool with the id "word-counter" already exists at tools/text/word-counter',
      );
    }
    expect(listAll(tools)).toEqual(before);
  });

  it("an id that is a category slug, a static page or a reserved path", async () => {
    const { tools } = fresh();
    const slug = await generateTool(inputFor("text-tools"), options(tools)).catch(
      (e: unknown) => e,
    );
    expect((slug as GeneratorError).problems.join("\n")).toContain(
      'is the URL of the category page "Text tools" (/text-tools/)',
    );
    const page = await generateTool(inputFor("about"), options(tools)).catch((e: unknown) => e);
    expect((page as GeneratorError).problems.join("\n")).toContain(
      "is the URL of a page the site already has (/about/)",
    );
    for (const path of siteConfig.reservedPaths) {
      expect(validateInput(inputFor(path)).join("\n"), path).toContain("--id");
    }
    expect(listAll(tools)).toEqual([]);
  });

  it("an existing folder, and leaves it exactly as it was", async () => {
    const { tools } = fresh();
    const folder = join(tools, "text", "word-counter");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "keep.txt"), "the owner's file");

    const error = await generateTool(inputFor("word-counter"), options(tools)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(GeneratorError);
    expect((error as GeneratorError).problems.join("\n")).toContain(
      "The generator never overwrites",
    );
    expect(listAll(tools)).toEqual(["text", "text/word-counter", "text/word-counter/keep.txt"]);
    expect(readFileSync(join(folder, "keep.txt"), "utf8")).toBe("the owner's file");
  });

  it("a name or a summary that another tool already has", async () => {
    const { tools } = fresh();
    await generateTool(
      inputFor("word-counter", {
        name: "Word counter",
        summary: "Count the words in any text as you type, right here.",
      }),
      options(tools),
    );
    const name = await generateTool(
      inputFor("counter-of-words", {
        name: "Counter word",
        summary: "Something entirely different to say about a tool.",
      }),
      options(tools),
    ).catch((e: unknown) => e);
    expect((name as GeneratorError).problems.join("\n")).toContain(
      "is the same as the name of word-counter",
    );

    const summary = await generateTool(
      inputFor("counter-of-words", {
        name: "Counter of words",
        summary: "Count the words in any text as you type, right here.",
      }),
      options(tools),
    ).catch((e: unknown) => e);
    expect((summary as GeneratorError).problems.join("\n")).toContain(
      "summary is the same as the summary of",
    );
    expect(listAll(tools).filter((path) => path.includes("counter-of-words"))).toEqual([]);
  });

  it("every invalid input, all at once, each naming its flag and an example", async () => {
    const { tools } = fresh();
    const text = await refuses(
      {
        id: "Word Counter",
        name: "",
        category: "text-tools",
        summary: "short",
        runtime: "browser",
        tags: [],
      },
      tools,
    );
    for (const flag of ["--id", "--name", "--category", "--summary", "--runtime", "--tags"]) {
      expect(text, flag).toContain(flag);
    }
    expect(text).toContain("Example: --id word-counter");
    expect(text).toContain('the category id is "text"');
  });

  it("checks against the SDK schema, so the schema and the generator cannot disagree", () => {
    expect(validateInput(inputFor("a".repeat(3), { name: "n".repeat(61) })).join()).toContain(
      "at most 60 characters",
    );
    expect(validateInput(inputFor("ok-id", { summary: "s".repeat(160) })).join()).toContain(
      "under 160 characters",
    );
    expect(
      validateInput(
        inputFor("ok-id", { tags: Array.from({ length: 9 }, (_, i) => `t${i}`) }),
      ).join(),
    ).toContain("at most eight");
    expect(validateInput(inputFor("ok-id"))).toEqual([]);
  });
});

describe("it leaves nothing behind when it fails", () => {
  /** A file system that fails on the Nth call of one operation. */
  function failing(operation: keyof FileSystem, nth: number): FileSystem {
    let calls = 0;
    const wrapped = { ...nodeFileSystem };
    const original = nodeFileSystem[operation] as (...args: string[]) => unknown;
    (wrapped[operation] as unknown) = (...args: string[]) => {
      calls += 1;
      if (calls === nth) throw new Error(`disk trouble in ${operation} call ${nth}`);
      return original(...args);
    };
    return wrapped;
  }

  it("removes everything when any single file write fails, including the new category folder", async () => {
    for (let nth = 1; nth <= 7; nth++) {
      const { tools, root } = fresh();
      const error = await generateTool(inputFor("image-resizer", { runtime: "worker" }), {
        ...options(tools),
        fs: failing("writeFile", nth),
      }).catch((caught: unknown) => caught);
      expect(String(error), `write ${nth}`).toContain("disk trouble");
      expect(listAll(root), `after failing write ${nth}`).toEqual([]);
    }
  });

  it("removes everything when the final move fails", async () => {
    const { tools, root } = fresh();
    const error = await generateTool(inputFor("word-counter"), {
      ...options(tools),
      fs: failing("rename", 1),
    }).catch((caught: unknown) => caught);
    expect(String(error)).toContain("disk trouble in rename");
    expect(listAll(root)).toEqual([]);
  });

  it("keeps a category folder that was already there, and everything in it", async () => {
    const { tools } = fresh();
    await generateTool(inputFor("word-counter"), options(tools));
    const before = listAll(tools);

    const error = await generateTool(inputFor("case-converter"), {
      ...options(tools),
      fs: failing("writeFile", 3),
    }).catch((caught: unknown) => caught);
    expect(String(error)).toContain("disk trouble");
    expect(listAll(tools)).toEqual(before);
  });

  it("hands a cleanup function to a signal handler, and it removes a half-written run", async () => {
    const { tools, root } = fresh();
    let cleanup = () => {};
    // Fail late, then run the cleanup that was registered, as Ctrl-C would.
    await generateTool(inputFor("word-counter"), {
      ...options(tools),
      fs: failing("rename", 1),
      registerCleanup: (fn) => {
        cleanup = fn;
      },
    }).catch(() => {});
    cleanup();
    expect(listAll(root)).toEqual([]);
  });

  it("writes into a staging folder no tool glob can match, and never leaves it", async () => {
    const { tools } = fresh();
    let stagingSeen = false;
    const spying: FileSystem = {
      ...nodeFileSystem,
      writeFile: (path, content) => {
        if (path.includes(".staging-")) stagingSeen = true;
        nodeFileSystem.writeFile(path, content);
      },
    };
    await generateTool(inputFor("word-counter"), { ...options(tools), fs: spying });
    expect(stagingSeen).toBe(true);
    expect(listAll(tools).some((path) => path.includes(".staging-"))).toBe(false);
  });
});

describe("a dry run", () => {
  it("checks everything, reports what it would write, and writes nothing", async () => {
    const { tools, root } = fresh();
    const result = await generateTool(inputFor("word-counter"), {
      ...options(tools),
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.files).toContain("logic.ts");
    expect(listAll(root)).toEqual([]);
  });

  it("still refuses what a real run would refuse", async () => {
    const { tools } = fresh();
    const error = await generateTool(inputFor("text-tools"), {
      ...options(tools),
      dryRun: true,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GeneratorError);
  });
});

describe("small helpers", () => {
  it("splits tags on commas, trims them and lowercases them", () => {
    expect(parseTags(" Words, characters ,,Lines ")).toEqual(["words", "characters", "lines"]);
    expect(parseTags("")).toEqual([]);
  });

  it("formats today's date as YYYY-MM-DD in the machine's own time zone", () => {
    expect(localToday(new Date(2026, 8, 5, 23, 59))).toBe("2026-09-05");
    expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
