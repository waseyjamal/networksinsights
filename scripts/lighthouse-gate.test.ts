import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gateVerdict, readSummaries, type ShardSummary } from "./lighthouse-gate";

const pass: ShardSummary = { ok: true, pages: 11, failing: [] };
const all = (count: number, summary: ShardSummary = pass) =>
  new Map<number, ShardSummary | undefined>(
    Array.from({ length: count }, (_, k) => [k + 1, summary] as const),
  );

describe("gateVerdict", () => {
  it("passes when all 6 shards succeeded", () => {
    expect(gateVerdict("success", 6, all(6))).toEqual({ ok: true, lines: [] });
  });

  it("passes the single changed-pages job of a tool-only pull request", () => {
    expect(gateVerdict("success", 1, all(1)).ok).toBe(true);
  });

  it("fails on a failed shard and names the shard and the page", () => {
    const summaries = all(6);
    summaries.set(4, {
      ok: false,
      pages: 11,
      failing: [{ path: "/word-counter/", problems: ["TBT 250 ms is over 200 ms"] }],
    });
    const verdict = gateVerdict("failure", 6, summaries);
    expect(verdict.ok).toBe(false);
    expect(verdict.lines).toContain("shard 4: /word-counter/: TBT 250 ms is over 200 ms");
  });

  it("fails on a cancelled shard", () => {
    const summaries = all(6);
    summaries.set(2, undefined);
    const verdict = gateVerdict("cancelled", 6, summaries);
    expect(verdict.ok).toBe(false);
    expect(verdict.lines.join("\n")).toMatch(/cancelled[\s\S]*shard 2: no summary/);
  });

  it("fails on a missing shard even when the matrix says success", () => {
    const summaries = all(6);
    summaries.delete(6);
    const verdict = gateVerdict("success", 6, summaries);
    expect(verdict.ok).toBe(false);
    expect(verdict.lines).toEqual(["shard 6: no summary, so it did not run or did not finish"]);
  });

  it("fails when the shards were skipped or the count is unknown", () => {
    expect(gateVerdict("skipped", 6, new Map()).ok).toBe(false);
    expect(gateVerdict("success", Number.NaN, new Map()).ok).toBe(false);
  });
});

describe("readSummaries", () => {
  it("reads present files and marks missing or broken ones", () => {
    const folder = mkdtempSync(join(tmpdir(), "ni-gate-"));
    try {
      writeFileSync(join(folder, "lighthouse-summary-1.json"), JSON.stringify(pass));
      writeFileSync(join(folder, "lighthouse-summary-2.json"), "{");
      const summaries = readSummaries(folder, 3);
      expect(summaries.get(1)).toEqual(pass);
      expect(summaries.get(2)).toBeUndefined();
      expect(summaries.get(3)).toBeUndefined();
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
