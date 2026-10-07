import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkFileSizes, formatFileSizeReport, MAX_FILE_BYTES } from "./lib/file-sizes";

// The file size check (ADR 0068) on small fake builds: no file may pass Cloudflare's 25 MiB.

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function dist(files: Record<string, number>): string {
  const dir = mkdtempSync(join(tmpdir(), "ni-file-sizes-"));
  made.push(dir);
  for (const [path, size] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), Buffer.alloc(size));
  }
  return dir;
}

describe("checkFileSizes", () => {
  it("passes a build whose largest file is exactly 25 MiB, and names it", () => {
    const report = checkFileSizes(dist({ "index.html": 10, "models/m/abc/part1": MAX_FILE_BYTES }));
    expect(report).toEqual({
      over: [],
      largest: { path: "models/m/abc/part1", bytes: MAX_FILE_BYTES },
      ok: true,
    });
    expect(formatFileSizeReport(report)).toBe(
      "File sizes: no file is over 25 MiB; the largest is models/m/abc/part1, 25.00 MiB (ADR 0068).",
    );
  });

  it("fails a build with a file one byte over, in any folder", () => {
    const report = checkFileSizes(
      dist({ "index.html": 10, "deep/a/b/decoder.onnx": MAX_FILE_BYTES + 1 }),
    );
    expect(report.ok).toBe(false);
    expect(report.over).toEqual([{ path: "deep/a/b/decoder.onnx", bytes: MAX_FILE_BYTES + 1 }]);
    expect(formatFileSizeReport(report)).toContain("deep/a/b/decoder.onnx is 25.00 MiB");
  });
});
