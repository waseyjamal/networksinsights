import { describe, expect, it } from "vitest";
import { toolOf } from "../seo/test-tools";
import { buildSearchIndex, isSearchable, serializeSearchIndex, toRecord } from "./index-build";
import { parseSearchIndex } from "./parse";
import { syntheticTools } from "./synthetic";

describe("the search index", () => {
  it("holds exactly the fields search needs, from the manifest", () => {
    const tool = toolOf("word-counter", "text", "2026-09-20", {
      name: "Word Counter",
      tags: ["count", "words"],
      accepts: ["Plain text"],
      produces: ["Plain text"],
    });
    expect(toRecord(tool)).toEqual({
      id: "word-counter",
      name: "Word Counter",
      summary: tool.manifest.summary,
      category: "text",
      tags: ["count", "words"],
      accepts: ["Plain text"],
      produces: ["Plain text"],
      href: "/word-counter/",
    });
  });

  it("leaves out accepts and produces when the manifest has none", () => {
    const record = toRecord(toolOf("word-counter"));
    expect("accepts" in record).toBe(false);
    expect("produces" in record).toBe(false);
  });

  it("leaves out deprecated tools, and keeps beta and stable ones", () => {
    const tools = [
      toolOf("a-tool", "text", "2026-09-20", { status: "stable" }),
      toolOf("b-tool", "text", "2026-09-20", { status: "beta" }),
      toolOf("c-tool", "text", "2026-09-20", { status: "deprecated" }),
    ];
    expect(tools.map(isSearchable)).toEqual([true, true, false]);
    expect(buildSearchIndex(tools).tools.map((record) => record.id)).toEqual(["a-tool", "b-tool"]);
  });

  it("is empty and valid with no tools", () => {
    expect(buildSearchIndex([])).toEqual({ version: 1, tools: [] });
    expect(serializeSearchIndex(buildSearchIndex([])).json).toBe('{"version":1,"tools":[]}');
  });

  it("is the same bytes for the same tools in any order", () => {
    const tools = syntheticTools(30);
    const forward = serializeSearchIndex(buildSearchIndex(tools));
    const backward = serializeSearchIndex(buildSearchIndex([...tools].reverse()));
    expect(backward).toEqual(forward);
  });

  it("gives a new file name when a word changes, and the same one when nothing does", () => {
    const one = toolOf("word-counter", "text", "2026-09-20", { name: "Word Counter" });
    const changed = toolOf("word-counter", "text", "2026-09-20", { name: "Word Count" });
    const a = serializeSearchIndex(buildSearchIndex([one]));
    expect(serializeSearchIndex(buildSearchIndex([one])).href).toBe(a.href);
    expect(serializeSearchIndex(buildSearchIndex([changed])).href).not.toBe(a.href);
    expect(a.href).toMatch(/^\/search-index\.[0-9a-f]{12}\.json$/);
  });
});

describe("reading an index", () => {
  it("round-trips what the build wrote", () => {
    const index = buildSearchIndex(syntheticTools(20));
    const { json } = serializeSearchIndex(index);
    expect(parseSearchIndex(JSON.parse(json))).toEqual(index.tools);
  });

  it("refuses anything that is not an index, instead of throwing", () => {
    for (const value of [
      null,
      undefined,
      "text",
      42,
      [],
      {},
      { version: 2, tools: [] },
      { version: 1 },
      { version: 1, tools: [{ id: "x" }] },
      { version: 1, tools: [null] },
      {
        version: 1,
        tools: [{ id: "x", name: 1, summary: "s", category: "c", tags: [], href: "/x/" }],
      },
      {
        version: 1,
        tools: [{ id: "x", name: "n", summary: "s", category: "c", tags: [1], href: "/x/" }],
      },
      {
        version: 1,
        tools: [
          {
            id: "x",
            name: "n",
            summary: "s",
            category: "c",
            tags: [],
            href: "https://example.com/",
          },
        ],
      },
      {
        version: 1,
        tools: [
          { id: "x", name: "n", summary: "s", category: "c", tags: [], href: "//example.com/" },
        ],
      },
      {
        version: 1,
        tools: [
          {
            id: "x",
            name: "n",
            summary: "s",
            category: "c",
            tags: [],
            href: "javascript:alert(1)",
          },
        ],
      },
    ]) {
      expect(parseSearchIndex(value), JSON.stringify(value)).toBeUndefined();
    }
  });
});

describe("synthetic tools", () => {
  it("are distinct, deterministic and valid records", () => {
    const tools = syntheticTools(1000);
    expect(new Set(tools.map((tool) => tool.manifest.id)).size).toBe(1000);
    expect(new Set(tools.map((tool) => tool.manifest.name)).size).toBe(1000);
    expect(syntheticTools(1000).map((tool) => tool.manifest.id)).toEqual(
      tools.map((tool) => tool.manifest.id),
    );
    for (const tool of tools) expect(tool.manifest.summary.length).toBeGreaterThanOrEqual(20);
  });

  it("stay distinct up to 5,000", () => {
    expect(new Set(syntheticTools(5000).map((tool) => tool.manifest.id)).size).toBe(5000);
  });
});
