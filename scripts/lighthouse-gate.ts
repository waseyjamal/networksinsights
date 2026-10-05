// node scripts/lighthouse-gate.ts <summaries folder>
//   (env: SHARDS_RESULT, the result of the lighthouse-shard matrix; SHARD_COUNT, how many shards
//   should have run)
//
// The `lighthouse` gate (ADR 0025, ADR 0063). It passes only when the matrix succeeded and every
// shard that should have run left a summary saying its pages are within budget. A failed,
// cancelled, skipped or missing shard fails it, and it names the shard and the pages. It imports
// only Node built-ins, so CI runs it with plain `node` and no install.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ShardSummary {
  ok: boolean;
  pages: number;
  failing: { path: string; problems: string[] }[];
}

/** The verdict of the gate: pass or not, and one line per problem. */
export function gateVerdict(
  matrixResult: string,
  shardCount: number,
  summaries: ReadonlyMap<number, ShardSummary | undefined>,
): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    lines.push(`expected shard count "${shardCount}" is not a number of at least 1`);
  }
  if (matrixResult !== "success")
    lines.push(`the Lighthouse shards finished with: ${matrixResult || "nothing"}`);
  for (let shard = 1; shard <= shardCount; shard++) {
    const summary = summaries.get(shard);
    if (!summary) {
      lines.push(`shard ${shard}: no summary, so it did not run or did not finish`);
      continue;
    }
    for (const page of summary.failing) {
      lines.push(`shard ${shard}: ${page.path}: ${page.problems.join("; ")}`);
    }
    if (!summary.ok && summary.failing.length === 0) lines.push(`shard ${shard}: not ok`);
  }
  return { ok: lines.length === 0, lines };
}

/** Reads `lighthouse-summary-<n>.json` for every shard from a folder. */
export function readSummaries(
  folder: string,
  shardCount: number,
): Map<number, ShardSummary | undefined> {
  const summaries = new Map<number, ShardSummary | undefined>();
  for (let shard = 1; shard <= shardCount; shard++) {
    const file = join(folder, `lighthouse-summary-${shard}.json`);
    try {
      summaries.set(
        shard,
        existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ShardSummary) : undefined,
      );
    } catch {
      summaries.set(shard, undefined);
    }
  }
  return summaries;
}

function main(folder: string | undefined): number {
  const count = Number(process.env.SHARD_COUNT);
  const verdict = gateVerdict(
    process.env.SHARDS_RESULT ?? "",
    count,
    readSummaries(folder ?? ".", Number.isInteger(count) ? count : 0),
  );
  if (verdict.ok) {
    console.log(`Every Lighthouse shard (${count}) passed.`);
    return 0;
  }
  for (const line of verdict.lines) console.error(line);
  return 1;
}

if (import.meta.main) process.exit(main(process.argv[2]));
