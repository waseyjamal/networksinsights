import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createEngine } from "./engine";
import { buildSearchIndex, serializeSearchIndex } from "./index-build";
import { syntheticTools } from "./synthetic";

// The slow tier (ADR 0043): work over 1,000 synthetic tools. The numbers are printed so the
// mission report can quote them, and asserted with room to spare so a busy CI runner does not
// turn a healthy engine into a red build.

const KB = 1024;
const size = (json: string) => ({
  raw: Buffer.byteLength(json),
  gzip: gzipSync(json, { level: 9 }).length,
  brotli: brotliCompressSync(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
});
const kb = (bytes: number) => `${(bytes / KB).toFixed(1)} KB`;

describe("index size", { tags: ["slow"] }, () => {
  it("is tiny with no tools and reports its size at 1,000", () => {
    const empty = size(serializeSearchIndex(buildSearchIndex([])).json);
    const full = size(serializeSearchIndex(buildSearchIndex(syntheticTools(1000))).json);
    console.log(
      `search index at 0 tools: ${empty.raw} B raw, ${empty.gzip} B gzip, ${empty.brotli} B brotli`,
    );
    console.log(
      `search index at 1,000 synthetic tools: ${full.raw} B raw (${kb(full.raw)}), ${full.gzip} B gzip (${kb(full.gzip)}), ${full.brotli} B brotli (${kb(full.brotli)})`,
    );
    expect(empty.raw).toBeLessThan(64);
    // Generous: at 1,000 tools a visitor downloads it once, on intent, and it is cached for good.
    expect(full.gzip).toBeLessThan(120 * KB);
  });
});

describe("search speed", { tags: ["slow"] }, () => {
  // A visitor types these one letter at a time. Every prefix is one keystroke.
  const typed = [
    "compress pdf",
    "comprss pdf",
    "jpg to png",
    "merge",
    "convert video to mp3",
    "resize image",
    "json format",
    "qr code",
    "base64 decode",
    "password generator",
  ];
  const keystrokes = typed.flatMap((query) =>
    Array.from({ length: query.length }, (_, i) => query.slice(0, i + 1)),
  );

  function measure(count: number) {
    const records = buildSearchIndex(syntheticTools(count)).tools;
    const builtAt = performance.now();
    const engine = createEngine(records);
    const buildMs = performance.now() - builtAt;

    // Warm up the JIT: the first calls of a page are slower than the hundredth, and both are real.
    for (const query of keystrokes) engine.search(query);

    const times: number[] = [];
    for (let round = 0; round < 5; round++) {
      for (const query of keystrokes) {
        const start = performance.now();
        engine.search(query);
        times.push(performance.now() - start);
      }
    }
    times.sort((a, b) => a - b);
    const at = (fraction: number) =>
      times[Math.min(times.length - 1, Math.floor(times.length * fraction))] ?? 0;
    return { buildMs, median: at(0.5), p95: at(0.95), max: at(1), samples: times.length };
  }

  it("answers one keystroke in under 10 ms at 1,000 tools", () => {
    const result = measure(1000);
    console.log(
      `search at 1,000 synthetic tools, ${result.samples} keystrokes: median ${result.median.toFixed(2)} ms, p95 ${result.p95.toFixed(2)} ms, max ${result.max.toFixed(2)} ms; index build ${result.buildMs.toFixed(1)} ms`,
    );
    expect(result.p95).toBeLessThan(10);
  });

  it("stays fast at 5,000 tools, five times the size the site starts at", () => {
    const result = measure(5000);
    console.log(
      `search at 5,000 synthetic tools, ${result.samples} keystrokes: median ${result.median.toFixed(2)} ms, p95 ${result.p95.toFixed(2)} ms, max ${result.max.toFixed(2)} ms; index build ${result.buildMs.toFixed(1)} ms`,
    );
    expect(result.p95).toBeLessThan(25);
  });
});
