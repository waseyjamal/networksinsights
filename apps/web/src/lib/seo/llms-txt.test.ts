import { describe, expect, it } from "vitest";
import { site } from "../../config/site";
import { buildLlmsTxt } from "./llms-txt";
import { toolOf } from "./test-tools";

describe("llms.txt", () => {
  const tools = [
    toolOf("word-counter", "text"),
    toolOf("case-converter", "text"),
    toolOf("merge-pdf", "pdf"),
  ];
  const text = buildLlmsTxt(tools);
  const lines = text.split("\n");

  it("starts with the site name as its H1 and a blockquote summary (llmstxt.org)", () => {
    expect(lines[0]).toBe(`# ${site.name}`);
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe(`> ${site.description}`);
  });

  it("has exactly one H1, and only H2 sections after it", () => {
    expect(lines.filter((line) => line.startsWith("# "))).toHaveLength(1);
    expect(lines.filter((line) => /^#{3,}/.test(line))).toEqual([]);
    expect(lines.filter((line) => line.startsWith("## "))).toEqual([
      "## Categories",
      "## Tools",
      "## Optional",
    ]);
  });

  it("lists every tool with an absolute link and its summary", () => {
    for (const tool of tools) {
      expect(text).toContain(
        `- [${tool.manifest.name}](https://networksinsights.com${tool.href}): ${tool.manifest.summary}`,
      );
    }
  });

  it("lists the tools by name", () => {
    const names = lines
      .filter((line) => line.startsWith("- ["))
      .map((line) => /\[(.*?)\]/.exec(line)?.[1]);
    const toolStart = names.indexOf("Case Converter");
    expect(names.slice(toolStart, toolStart + 3)).toEqual([
      "Case Converter",
      "Merge Pdf",
      "Word Counter",
    ]);
  });

  it("lists only the categories that have a tool", () => {
    expect(text).toContain("(https://networksinsights.com/text-tools/)");
    expect(text).toContain("(https://networksinsights.com/pdf-tools/)");
    expect(text).not.toContain("/image-tools/");
    expect(text).not.toContain("/calculators/");
  });

  it("formats every list item as a Markdown link, and links only to this site", () => {
    const items = lines.filter((line) => line.startsWith("- "));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item).toMatch(/^- \[[^\]]+\]\(https:\/\/networksinsights\.com\/[a-z0-9/-]*\)(: .+)?$/);
    }
  });

  it("puts the site pages under Optional, where an agent may skip them", () => {
    const optional = text.slice(text.indexOf("## Optional"));
    for (const path of ["/tools/", "/about/", "/contact/", "/privacy/", "/terms/"]) {
      expect(optional).toContain(`(https://networksinsights.com${path})`);
    }
  });

  it("has no Categories or Tools section when there are no tools, and still parses", () => {
    const empty = buildLlmsTxt([]);
    expect(empty).not.toContain("## Categories");
    expect(empty).not.toContain("## Tools");
    expect(empty).toContain("## Optional");
    expect(empty.startsWith(`# ${site.name}\n\n> `)).toBe(true);
  });

  it("names no design-system or 404 page", () => {
    expect(text).not.toContain("design-system");
    expect(text).not.toContain("404");
  });
});
