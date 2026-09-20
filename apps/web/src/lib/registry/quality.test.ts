import { ToolContractError } from "@networksinsights/tool-sdk";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it, vi } from "vitest";
import Content from "../../components/tool/fixture-content.astro";
import Island from "../../components/tool/fixture-island.astro";
import ToolPage from "../../components/tool/ToolPage.astro";
import { categoryById } from "../../config/categories";
import { buildRegistry } from "./build";
import { toEntries } from "./entries";
import indexSource from "./index.ts?raw";
import { enforceQuality, qualityMode, ToolQualityError } from "./quality";

// What the site does with a content quality problem (ADR 0036): stop the production build, but
// only warn in `astro dev`, so a tool that is still being written keeps rendering. Contract
// violations are hard failures in both.
//
// The fixtures are the "valid" and "tampered-island" cases of registry.test.ts. Their content is
// the stand-in text "Words about how to use." — exactly what a work-in-progress tool looks like to
// the quality gates.

const fixtures = {
  manifests: import.meta.glob("./fixtures/*/*/*/tool.config.ts", { eager: true }),
  files: import.meta.glob(
    [
      "./fixtures/*/*/*/tool.config.ts",
      "./fixtures/*/*/*/logic.ts",
      "./fixtures/*/*/*/logic.test.ts",
      "./fixtures/*/*/*/ui.tsx",
      "./fixtures/*/*/*/island.astro",
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

const entries = toEntries(fixtures, "fixtures", 3);
const set = (name: string) => entries.filter((entry) => entry.dir.startsWith(`fixtures/${name}/`));

const finished = import.meta.glob(
  "../../../../../packages/tool-sdk/src/quality/fixtures/pages/word-counter.mdx",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;
const goodPage = Object.values(finished)[0] ?? "";

/** The word-counter fixture, with a finished page in place of the stand-in text. */
const readyTool = () =>
  set("valid")
    .filter((entry) => entry.dir.endsWith("/word-counter"))
    .map((entry) => ({ ...entry, content: goodPage }));

describe("which answer each place gives", () => {
  it("warns in `astro dev` and fails everywhere else", () => {
    expect(qualityMode(true)).toBe("warn");
    expect(qualityMode(false)).toBe("fail");
  });

  it("asks the registry for the answer that fits the environment Vite is in", () => {
    expect(indexSource).toContain("qualityMode(import.meta.env.DEV)");
  });
});

describe("in dev: a work-in-progress tool warns and keeps going", () => {
  it("does not throw, and prints one readable warning that names the tool and the fix", () => {
    const warn = vi.fn();
    const found = enforceQuality(set("valid"), "warn", warn);

    expect(found.length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain("content quality problems");
    expect(message).toContain("the pages still render");
    expect(message).toContain('Quality gate "min-words": fixtures/valid/text/word-counter');
    expect(message).toContain("File:    fixtures/valid/text/word-counter/content/en.mdx");
    expect(message).toContain("Fix:");
    expect(message).toContain("pnpm check:tools --tool <tool-id>");
  });

  it("still renders the tool page", async () => {
    enforceQuality(set("valid"), "warn", () => {});
    const category = categoryById("text");
    if (!category) throw new Error("the text category is missing");
    const registry = buildRegistry(set("valid"));
    const tool = registry.byId.get("word-counter");
    if (!tool) throw new Error("the fixture tool is missing");

    const container = await AstroContainer.create();
    const html = await container.renderToString(ToolPage, {
      props: { tool, category, related: [], Island, Content },
    });
    expect(html).toContain("<h1");
    expect(html).toContain("Word counter");
  });
});

describe("in the production build: the same problems stop the build", () => {
  it("throws, listing every problem with its folder, file and fix", () => {
    const attempt = () => enforceQuality(set("valid"), "fail");
    expect(attempt).toThrow(ToolQualityError);
    try {
      attempt();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("content quality problems (ADR 0036)");
      expect(message).toContain('Quality gate "min-words": fixtures/valid/text/word-counter');
      expect(message).toContain("Fix:");
      expect((error as ToolQualityError).violations.length).toBeGreaterThan(0);
    }
  });

  it("finds the same problems as dev does, so a warning is a promise about the build", () => {
    const warn = vi.fn();
    const inDev = enforceQuality(set("valid"), "warn", warn);
    let inBuild: unknown;
    try {
      enforceQuality(set("valid"), "fail");
    } catch (error) {
      inBuild = (error as ToolQualityError).violations;
    }
    expect(inBuild).toEqual(inDev);
  });
});

describe("a finished tool", () => {
  it("passes in both modes without a warning", () => {
    const warn = vi.fn();
    expect(enforceQuality(readyTool(), "warn", warn)).toEqual([]);
    expect(enforceQuality(readyTool(), "fail")).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("contract violations are hard failures everywhere", () => {
  let container: Awaited<ReturnType<typeof AstroContainer.create>>;
  beforeAll(async () => {
    container = await AstroContainer.create();
  });

  it("throws from the registry whatever the quality mode is", () => {
    // build.ts has no mode at all: a tampered island breaks rendering, so nothing softens it.
    expect(() => buildRegistry(set("tampered-island"))).toThrow(ToolContractError);
    expect(() => buildRegistry(set("missing-test"))).toThrow(ToolContractError);
    expect(container).toBeTruthy();
  });

  it("is not something the quality module can soften", () => {
    // enforceQuality reports quality gates only; it never sees or hides a contract error.
    const warn = vi.fn();
    enforceQuality(set("tampered-island"), "warn", warn);
    const text = String(warn.mock.calls[0]?.[0] ?? "");
    expect(text).not.toContain("Tool contract:");
  });
});
