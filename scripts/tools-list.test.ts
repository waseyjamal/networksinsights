import { describe, expect, it } from "vitest";
import { renderToolsList } from "./lib/tools-list";

const names = new Map([
  ["text", "Text"],
  ["image", "Image"],
]);

describe("renderToolsList", () => {
  const rows = [
    { id: "b-tool", name: "B", category: "text", runtime: "client", summary: "Does b | c." },
    { id: "a-tool", name: "A", category: "image", runtime: "worker", summary: "Does a." },
    { id: "a-text", name: "A2", category: "text", runtime: "client", summary: "Does a2." },
  ];
  const out = renderToolsList(rows, names);

  it("has one row per tool, grouped by category name then id", () => {
    const body = out.split("\n").filter((line) => line.startsWith("| ") && !line.includes("---"));
    expect(body.map((line) => line.split(" | ")[0])).toEqual([
      "| id",
      "| a-tool",
      "| a-text",
      "| b-tool",
    ]);
  });

  it("shows the category name, the runtime and the count", () => {
    expect(out).toContain("| a-tool | A | Image | worker | Does a. |");
    expect(out).toContain("3 tools.");
  });

  it("escapes a pipe in a summary and ends with one newline", () => {
    expect(out).toContain("Does b \\| c.");
    expect(out.endsWith("|\n")).toBe(true);
  });
});
