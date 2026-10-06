import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkOnnxruntimePages,
  formatOnnxruntimeReport,
  ONNXRUNTIME_WASM_PATH,
} from "./lib/onnxruntime-pages";

// The ONNX Runtime check (ADR 0066) on small fake builds: the engine may be reached only from the
// two AI image tool pages, they must reach it, and its wasm must be the one vendored file.

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function dist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ni-onnxruntime-"));
  made.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const island = (component: string) =>
  `<astro-island component-url="${component}" renderer-url="/_astro/client.js"></astro-island>`;
const ui = (worker: string) =>
  `const w = new Worker(new URL("${worker}", "" + import.meta.url), { type: "module" });`;
const engine = "/*! ONNX Runtime Web v1.30.0 */ export const ort = 1;";
const wasm = "\0asm onnxruntime::InferenceSession";

const good = {
  "_astro/client.js": "export {};",
  "_astro/ui-up.js": ui("/_astro/worker-up.js"),
  "_astro/ui-bg.js": ui("/_astro/worker-bg.js"),
  "_astro/worker-up.js": engine,
  "_astro/worker-bg.js": engine,
  "image-upscaler/index.html": island("/_astro/ui-up.js"),
  "background-remover/index.html": island("/_astro/ui-bg.js"),
  "word-counter/index.html": island("/_astro/client.js"),
  "index.html": '<script type="module" src="/_astro/client.js"></script>',
  [ONNXRUNTIME_WASM_PATH]: wasm,
};

describe("checkOnnxruntimePages", () => {
  it("passes when only the two tool pages reach the engine and its wasm is vendored once", () => {
    const report = checkOnnxruntimePages(dist(good));
    expect(report).toEqual({
      strayPages: [],
      missing: [],
      wasmCopies: [ONNXRUNTIME_WASM_PATH],
      ok: true,
    });
    expect(formatOnnxruntimeReport(report)).toContain(
      "only /image-upscaler/ and /background-remover/",
    );
  });

  it("fails when another page can load the engine, even on demand", () => {
    const report = checkOnnxruntimePages(
      dist({ ...good, "word-counter/index.html": island("/_astro/ui-up.js") }),
    );
    expect(report.ok).toBe(false);
    expect(report.strayPages).toEqual(["word-counter/index.html (_astro/worker-up.js)"]);
    expect(formatOnnxruntimeReport(report)).toContain("word-counter/index.html");
  });

  it("fails when a tool page no longer reaches the engine, so the check would be blind", () => {
    const report = checkOnnxruntimePages(dist({ ...good, "_astro/worker-bg.js": "export {};" }));
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual(["background-remover/index.html"]);
  });

  it("fails when the engine's wasm is bundled a second time or is missing", () => {
    const twice = checkOnnxruntimePages(dist({ ...good, "_astro/ort-abc.wasm": wasm }));
    expect(twice.ok).toBe(false);
    expect(twice.wasmCopies).toEqual(["_astro/ort-abc.wasm", ONNXRUNTIME_WASM_PATH]);
    const { [ONNXRUNTIME_WASM_PATH]: _, ...without } = good;
    const none = checkOnnxruntimePages(dist(without));
    expect(none.ok).toBe(false);
    expect(formatOnnxruntimeReport(none)).toContain("found: none");
  });
});
