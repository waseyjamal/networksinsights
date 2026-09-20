import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool, toolManifestSchema } from "./manifest";
import type { ToolManifest } from "./types";

const valid: ToolManifest = {
  id: "word-counter",
  name: "Word counter",
  category: "text",
  summary: "Count the words, characters and lines in any text, as you type.",
  tags: ["words", "characters", "count"],
  runtime: "client",
  status: "beta",
  input: z.object({ text: z.string() }),
  related: ["case-converter"],
  added: "2026-09-20",
  updated: "2026-09-20",
};

/** The first message for a field, so a test can name the exact rule it checks. */
function problems(manifest: unknown): string[] {
  const parsed = toolManifestSchema.safeParse(manifest);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe("defineTool", () => {
  it("returns the manifest unchanged, so validation can happen once and name the folder", () => {
    expect(defineTool(valid)).toBe(valid);
  });
});

describe("toolManifestSchema", () => {
  it("accepts a valid manifest", () => {
    expect(toolManifestSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an optional limits object and a missing one", () => {
    expect(toolManifestSchema.safeParse({ ...valid, limits: { maxFiles: 5 } }).success).toBe(true);
    expect(toolManifestSchema.safeParse({ ...valid, limits: {} }).success).toBe(true);
    expect(problems({ ...valid, limits: { maxFiles: 0 } })).toContain(
      "limits.maxFiles must be a positive whole number",
    );
    expect(problems({ ...valid, limits: { maxFiles: 1.5 } }).length).toBeGreaterThan(0);
  });

  it("requires kebab-case for the id, the category and every tag", () => {
    for (const field of ["id", "category"] as const) {
      expect(problems({ ...valid, [field]: "Word Counter" }).join()).toContain("kebab-case");
    }
    expect(problems({ ...valid, tags: ["Words"] }).join()).toContain("kebab-case");
  });

  it("allows digits in ids and tags, because real tool names have them", () => {
    expect(
      toolManifestSchema.safeParse({
        ...valid,
        id: "sha-256-hash",
        tags: ["base64", "utf-8", "h-264"],
      }).success,
    ).toBe(true);
  });

  it("keeps the summary long enough to be useful and short enough to be a meta description", () => {
    expect(problems({ ...valid, summary: "Counts words." })).toContain(
      "summary must be at least 20 characters",
    );
    expect(problems({ ...valid, summary: "x".repeat(160) }).join()).toContain("under 160");
    expect(toolManifestSchema.safeParse({ ...valid, summary: "x".repeat(159) }).success).toBe(true);
  });

  it("allows digits in the summary: Base64, SHA-256, MP4, UTF-8 and H.264 are real names", () => {
    const summary = "Convert an MP4 to H.264 and check its SHA-256 and Base64 in UTF-8 form.";
    expect(toolManifestSchema.safeParse({ ...valid, summary }).success).toBe(true);
  });

  it("requires at least one tag, at most eight, and no repeats", () => {
    expect(problems({ ...valid, tags: [] }).join()).toContain("at least one tag");
    expect(
      problems({ ...valid, tags: Array.from({ length: 9 }, (_, i) => `t-${i}`) }).join(),
    ).toContain("at most eight");
    expect(problems({ ...valid, tags: ["a", "a"] })).toContain("tags must not repeat");
  });

  it("accepts only the three runtimes and the three statuses", () => {
    for (const runtime of ["client", "worker", "server"]) {
      expect(toolManifestSchema.safeParse({ ...valid, runtime }).success).toBe(true);
    }
    for (const status of ["beta", "stable", "deprecated"]) {
      expect(toolManifestSchema.safeParse({ ...valid, status }).success).toBe(true);
    }
    expect(toolManifestSchema.safeParse({ ...valid, runtime: "edge" }).success).toBe(false);
    expect(toolManifestSchema.safeParse({ ...valid, status: "alpha" }).success).toBe(false);
  });

  it("requires input to be a Zod schema", () => {
    expect(problems({ ...valid, input: { text: "string" } })).toContain(
      "input must be a Zod schema (ADR 0006)",
    );
    expect(toolManifestSchema.safeParse({ ...valid, input: z.string() }).success).toBe(true);
  });

  it("accepts an empty related list, at most six, and no repeats", () => {
    expect(toolManifestSchema.safeParse({ ...valid, related: [] }).success).toBe(true);
    expect(problems({ ...valid, related: ["a", "a"] })).toContain(
      "related must not repeat a tool id",
    );
    expect(problems({ ...valid, related: ["a", "b", "c", "d", "e", "f", "g"] }).join()).toContain(
      "at most six",
    );
  });

  it("requires real ISO dates", () => {
    expect(problems({ ...valid, added: "20-09-2026" }).join()).toContain("ISO date");
    expect(problems({ ...valid, added: "2026-02-30" }).join()).toContain("real calendar date");
    expect(problems({ ...valid, added: "2026-13-01" }).join()).toContain("real calendar date");
  });

  it("refuses a field the contract does not have, so typos are caught", () => {
    expect(problems({ ...valid, descriptoin: "typo" }).join()).toContain("Unrecognized key");
  });

  it("refuses a missing required field", () => {
    const { summary: _summary, ...withoutSummary } = valid;
    expect(toolManifestSchema.safeParse(withoutSummary).success).toBe(false);
  });
});
