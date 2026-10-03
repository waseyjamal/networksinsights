import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every advisory that pnpm audit ignores, with the last day the ignore may stay (ADR 0059).
const recheckBy: Record<string, string> = {
  "GHSA-ch52-4w7c-c8xp": "2026-10-17",
};

const workspace = readFileSync(join(import.meta.dirname, "..", "pnpm-workspace.yaml"), "utf8");
const ignored = [...workspace.matchAll(/^\s+-\s+(GHSA-[\w-]+)\s*$/gm)].map(
  (match) => match[1] ?? "",
);

describe("pnpm audit ignores", () => {
  it("lists a re-check date for every ignored advisory", () => {
    for (const ghsa of ignored)
      expect(recheckBy[ghsa], `${ghsa} has no re-check date`).toBeDefined();
  });

  it("fails once an ignore is past its re-check date", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const ghsa of ignored) {
      expect(
        today <= (recheckBy[ghsa] ?? ""),
        `${ghsa}: re-check passed ${recheckBy[ghsa]}; see ADR 0059`,
      ).toBe(true);
    }
  });
});
