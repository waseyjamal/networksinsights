import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readHeifInfo } from "../../../../tools/image/heic-to-jpg/logic";
import { ENGINE_BYTES, LANGUAGES } from "../../../../tools/image/ocr/logic";
import { LIBHEIF_FILES } from "./libheif";
import { TESSERACT_FILES } from "./tesseract";

// The files HEIC to JPG and OCR fetch from this site (ADR 0060): every one exists in the installed
// package, none passes Cloudflare's 25 MiB limit for one file, and the sizes the OCR page states
// are the real sizes of the files served.

const repo = join(import.meta.dirname, "..", "..", "..", "..");
const installed = (name: string, path: string) => join(repo, "tools", "node_modules", name, path);
const MiB = 1024 * 1024;

describe("vendored files", () => {
  it("copies libheif's files from libheif-js, each under 25 MiB", () => {
    for (const from of Object.keys(LIBHEIF_FILES)) {
      expect(statSync(installed("libheif-js", from)).size).toBeLessThan(25 * MiB);
    }
  });

  it("copies Tesseract's files, each under 25 MiB", () => {
    for (const [name, path] of Object.values(TESSERACT_FILES)) {
      expect(statSync(installed(name, path)).size, path).toBeLessThan(25 * MiB);
    }
  });

  it("states the real size of each language file and of the engine", () => {
    const size = (published: keyof typeof TESSERACT_FILES) => {
      const [name, path] = TESSERACT_FILES[published];
      return statSync(installed(name, path)).size;
    };
    expect(LANGUAGES.eng.bytes).toBe(size("lang/eng.traineddata.gz"));
    expect(LANGUAGES.hin.bytes).toBe(size("lang/hin.traineddata.gz"));
    const simd = size("tesseract-core-simd.js") + size("tesseract-core-simd.wasm");
    const plain = size("tesseract-core.js") + size("tesseract-core.wasm");
    expect(ENGINE_BYTES).toBe(Math.max(simd, plain) + size("worker.min.js"));
  });
});

describe("the HEIC fixtures", () => {
  const fixture = (name: string) =>
    new Uint8Array(readFileSync(join(import.meta.dirname, "..", "..", "e2e", "fixtures", name)));

  it("reads a real HEIC's size from its boxes, turned by its irot box", () => {
    expect(readHeifInfo(fixture("landscape.heic"))).toEqual({ ok: true, width: 320, height: 240 });
    expect(readHeifInfo(fixture("rotated.heic"))).toEqual({ ok: true, width: 240, height: 320 });
  });
});
