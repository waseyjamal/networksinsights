import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { adrProblem } from "./lib/adr";

const dir = mkdtempSync(join(tmpdir(), "ni-adr-"));
writeFileSync(join(dir, "0051-accepted.md"), "# 0051. Accepted\n\nStatus: Accepted\n");
writeFileSync(join(dir, "0052-proposed.md"), "# 0052. Proposed\n\nStatus: Proposed\n");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("adrProblem", () => {
  it("accepts an accepted ADR", () => {
    expect(adrProblem("0051", dir)).toBe(undefined);
  });

  it("refuses a missing or unaccepted one, saying why", () => {
    expect(adrProblem("0099", dir)).toBe("there is no ADR 0099 in docs/adr/");
    expect(adrProblem("0052", dir)).toContain("Status: Proposed, not Accepted");
  });

  it("reads the real ADR folder", () => {
    expect(adrProblem("0019")).toBe(undefined);
  });
});
