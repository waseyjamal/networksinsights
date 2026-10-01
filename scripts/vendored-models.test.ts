// The on-device AI models tools serve (ADR 0057): each file is the one its VENDOR.md records, by
// SHA-256 and size, next to its licence, and the download size a tool page states is the real
// size of the files the build serves. Here rather than in the tool's own tests, because tool
// tests have no Node file access.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { DOWNLOAD_BYTES } from "../tools/image/background-remover/logic";

const root = new URL("../tools/image/background-remover/model/", import.meta.url);

describe("Background Remover model", () => {
  const model = new URL("u2netp.onnx", root);

  it("is the file VENDOR.md records, with its licence", () => {
    const bytes = readFileSync(model);
    const vendor = readFileSync(new URL("VENDOR.md", root), "utf8");
    const sha = createHash("sha256").update(bytes).digest("hex");
    expect(sha).toBe("309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8");
    expect(vendor).toContain(sha);
    expect(vendor).toContain(bytes.length.toLocaleString("en-US"));
    expect(existsSync(new URL("LICENSE", root))).toBe(true);
    expect(readFileSync(new URL("LICENSE", root), "utf8")).toContain("Apache License");
  });

  it("states the real download size of the model and the runtime", () => {
    expect(statSync(model).size).toBe(DOWNLOAD_BYTES.model);
    const require = createRequire(new URL("../tools/package.json", import.meta.url));
    const wasm = require.resolve("onnxruntime-web/ort-wasm-simd-threaded.wasm");
    expect(statSync(wasm).size).toBe(DOWNLOAD_BYTES.runtime);
  });

  it("stays under the Cloudflare static asset limit of 25 MiB per file", () => {
    expect(DOWNLOAD_BYTES.model).toBeLessThan(25 * 1024 * 1024);
    expect(DOWNLOAD_BYTES.runtime).toBeLessThan(25 * 1024 * 1024);
  });
});
