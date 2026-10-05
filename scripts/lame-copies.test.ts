import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkLameCopies, containsLame, LAME_WASM_PATH } from "./lib/lame-copies";

// The LAME check (ADR 0064) on small build folders made here from the installed package: the real
// mp3.wasm, and the package's own ES build, which inlines the same wasm as base64.

const installed = join(import.meta.dirname, "..", "tools", "node_modules", "wasm-media-encoders");
const wasm = join(installed, "wasm", "mp3.wasm");
const inlined = join(installed, "dist", "es", "index.mjs");
const made: string[] = [];

function dist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "lame-"));
  made.push(dir);
  for (const [to, from] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, to)), { recursive: true });
    cpSync(from, join(dir, to));
  }
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the LAME check", () => {
  it("finds LAME in the raw wasm and in the package's base64 copy", () => {
    expect(containsLame(readFileSync(wasm))).toBe(true);
    expect(containsLame(readFileSync(inlined))).toBe(true);
    expect(containsLame(Buffer.from("export const x = 1;"))).toBe(false);
  });

  it("passes with the vendored wasm alone", () => {
    const report = checkLameCopies(dist({ [LAME_WASM_PATH]: wasm }));
    expect(report).toEqual({ copies: [LAME_WASM_PATH], ok: true });
  });

  it("fails on a second copy inlined into a script", () => {
    const report = checkLameCopies(
      dist({ [LAME_WASM_PATH]: wasm, "_astro/worker-abc.js": inlined }),
    );
    expect(report.ok).toBe(false);
    expect(report.copies).toEqual(["_astro/worker-abc.js", LAME_WASM_PATH]);
  });

  it("fails with no copy, or a copy somewhere else", () => {
    const empty = dist({});
    writeFileSync(join(empty, "index.html"), "<p>hello</p>");
    expect(checkLameCopies(empty).ok).toBe(false);
    expect(checkLameCopies(dist({ "vendor/lame/mp3.wasm": wasm })).ok).toBe(false);
  });
});
