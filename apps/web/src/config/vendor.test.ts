import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as remover from "../../../../tools/image/background-remover/logic";
import { readHeifInfo } from "../../../../tools/image/heic-to-jpg/logic";
import * as upscaler from "../../../../tools/image/image-upscaler/logic";
import { ENGINE_BYTES, LANGUAGES } from "../../../../tools/image/ocr/logic";
import { IMMUTABLE, immutablePaths, versionedVendorPaths } from "./headers";
import { LAME_BASE, LAME_FILES } from "./lame";
import { LIBHEIF_BASE, LIBHEIF_FILES } from "./libheif";
import { MODEL_PATHS, MODELS, modelBase } from "./models";
import { ONNXRUNTIME_BASE, ONNXRUNTIME_FILES } from "./onnxruntime";
import { PDFJS_BASE } from "./pdfjs";
import { TESSERACT_BASE, TESSERACT_FILES } from "./tesseract";

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

  it("copies the LAME encoder's files from wasm-media-encoders, each under 25 MiB", () => {
    for (const from of Object.keys(LAME_FILES)) {
      expect(statSync(installed("wasm-media-encoders", from)).size).toBeLessThan(25 * MiB);
    }
  });

  it("copies only ONNX Runtime's plain wasm backend, under 25 MiB, and states its real size", () => {
    let bytes = 0;
    for (const from of Object.keys(ONNXRUNTIME_FILES)) {
      expect(from, from).not.toMatch(/jsep|jspi|asyncify|webgpu/);
      const size = statSync(installed("onnxruntime-web", from)).size;
      expect(size, from).toBeLessThan(25 * MiB);
      bytes += size;
    }
    for (const tool of [upscaler, remover]) {
      expect(tool.ENGINE.base).toBe(ONNXRUNTIME_BASE);
      expect(Object.values(ONNXRUNTIME_FILES) as string[]).toContain(tool.ENGINE.mjs);
      expect(Object.values(ONNXRUNTIME_FILES) as string[]).toContain(tool.ENGINE.wasm);
      expect(tool.ENGINE.bytes).toBe(bytes);
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

describe("cache headers of vendored files (ADR 0061)", () => {
  /** The version in the installed package's own package.json, not the one we asked for. */
  const installedVersion = (name: string) =>
    (JSON.parse(readFileSync(installed(name, "package.json"), "utf8")) as { version: string })
      .version;

  it("caches each versioned vendor folder for good, named with the installed package version", () => {
    expect(IMMUTABLE).toBe("public, max-age=31536000, immutable");
    expect(versionedVendorPaths).toEqual([
      `${PDFJS_BASE}*`,
      `${LIBHEIF_BASE}*`,
      `${LAME_BASE}*`,
      `${ONNXRUNTIME_BASE}*`,
    ]);
    for (const path of versionedVendorPaths) expect(immutablePaths).toContain(path);
    expect(versionedVendorPaths[0]).toBe(`/vendor/pdfjs/${installedVersion("pdfjs-dist")}/*`);
    expect(versionedVendorPaths[1]).toBe(`/vendor/libheif/${installedVersion("libheif-js")}/*`);
    expect(versionedVendorPaths[2]).toBe(
      `/vendor/wasm-media-encoders/${installedVersion("wasm-media-encoders")}/*`,
    );
    expect(versionedVendorPaths[3]).toBe(
      `/vendor/onnxruntime-web/${installedVersion("onnxruntime-web")}/*`,
    );
  });

  it("keeps Tesseract and every path without a version out of the long cache", () => {
    // Tesseract's language data comes from other packages than the version in its path.
    expect(immutablePaths.some((path) => path.startsWith(TESSERACT_BASE))).toBe(false);
    expect(immutablePaths.some((path) => path.startsWith("/vendor/tesseract"))).toBe(false);
    for (const path of immutablePaths.filter((entry) => entry.startsWith("/vendor/"))) {
      expect(path, path).toMatch(/^\/vendor\/[a-z]+(-[a-z]+)*\/\d+\.\d+\.\d+\/\*$/);
    }
  });
});

describe("the AI models (ADR 0066)", () => {
  const file = (id: string, name: string) => join(repo, "models", id, name);

  it("holds every model file with the size and SHA-256 stated, under 25 MiB, with its licence", () => {
    for (const model of Object.values(MODELS)) {
      const bytes = readFileSync(file(model.id, "model.onnx"));
      expect(createHash("sha256").update(bytes).digest("hex"), model.id).toBe(model.sha256);
      expect(bytes.length, model.id).toBe(model.bytes);
      expect(bytes.length, model.id).toBeLessThan(25 * MiB);
      expect(statSync(file(model.id, "LICENSE.txt")).size, model.id).toBeGreaterThan(1000);
    }
    expect(readFileSync(file("realesr-general-x4v3", "LICENSE.txt"), "utf8")).toContain(
      "BSD 3-Clause License",
    );
    expect(readFileSync(file("modnet", "LICENSE.txt"), "utf8")).toContain(
      "Version 2.0, January 2004",
    );
  });

  it("gives each tool the model's real path, hash and size", () => {
    const upscale = MODELS["realesr-general-x4v3"];
    expect(upscaler.MODEL).toEqual({
      url: `${modelBase(upscale)}model.onnx`,
      sha256: upscale.sha256,
      bytes: upscale.bytes,
    });
    const matte = MODELS.modnet;
    expect(remover.MODEL).toEqual({
      url: `${modelBase(matte)}model.onnx`,
      sha256: matte.sha256,
      bytes: matte.bytes,
    });
  });

  it("caches the models for good, since each path holds the start of the file's hash", () => {
    expect(immutablePaths).toContain(MODEL_PATHS);
    for (const model of Object.values(MODELS)) {
      expect(modelBase(model)).toBe(`/models/${model.id}/${model.sha256.slice(0, 16)}/`);
    }
  });
});
