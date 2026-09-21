import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toolManifestSchema } from "./manifest";

// The optional `accepts` and `produces` fields of a manifest (ADR 0044).

const valid = {
  id: "png-to-jpg",
  name: "PNG to JPG",
  category: "image",
  summary: "Convert a PNG picture to a JPG file, in your browser.",
  tags: ["png", "jpg"],
  runtime: "client",
  status: "beta",
  input: z.object({}),
  related: [],
  added: "2026-09-20",
  updated: "2026-09-20",
};

const problems = (extra: Record<string, unknown>) => {
  const result = toolManifestSchema.safeParse({ ...valid, ...extra });
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe("accepts and produces", () => {
  it("are optional", () => {
    expect(problems({})).toEqual([]);
  });

  it("take file formats as a reader names them", () => {
    expect(
      problems({
        accepts: ["PNG"],
        produces: ["JPG", "WebP", "H.264", "Plain text", "PDF/A", "C#"],
      }),
    ).toEqual([]);
  });

  it("refuse an empty list, so a tool says nothing rather than an empty line", () => {
    expect(problems({ accepts: [] }).join()).toContain("at least one format");
    expect(problems({ produces: [] }).join()).toContain("at least one format");
  });

  it("refuse more than twelve formats, and a format that is repeated (in any case)", () => {
    const many = Array.from({ length: 13 }, (_, index) => `F${index}`);
    expect(problems({ accepts: many }).join()).toContain("at most twelve");
    expect(problems({ accepts: ["PNG", "png"] }).join()).toContain("must not repeat");
  });

  it("refuse a format that is a sentence, a path or markup", () => {
    for (const bad of [
      "",
      " PNG",
      "PNG ",
      "x".repeat(25),
      "<b>PNG</b>",
      "png, jpg",
      "a\nb",
      "../x",
      "PNG!",
    ]) {
      expect(problems({ accepts: [bad] }).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });

  it("refuse anything that is not a list", () => {
    expect(problems({ accepts: "PNG" }).length).toBeGreaterThan(0);
    expect(problems({ produces: [1, 2] }).length).toBeGreaterThan(0);
  });
});
