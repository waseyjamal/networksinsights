// The ONNX Runtime check (ADR 0066, ADR 0068): the AI engine reaches only the pages of the tools that use it.
// Every other page must load none of it, not even on demand, and the engine's WebAssembly must be
// in the build exactly once, as the unmodified file in its vendor folder, never inside a bundle.
// `pnpm check:budgets` runs it on the build output.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { findIslands, reach, resolveUrl } from "./budgets";

/** The banner ONNX Runtime Web keeps at the top of its bundle, in every build of it. */
export const ONNXRUNTIME_SIGNATURE = "ONNX Runtime Web v";

/** The one place the engine's WebAssembly may be, relative to the build output. */
export const ONNXRUNTIME_WASM_PATH = "vendor/onnxruntime-web/1.30.0/ort-wasm-simd-threaded.wasm";

/** The pages whose tools run the engine. */
export const ONNXRUNTIME_PAGES = [
  "image-upscaler/index.html",
  "background-remover/index.html",
  "speech-to-text/index.html",
];

/** "a", "a and b", "a, b and c". */
const list = (items: readonly string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

function* walk(dir: string, pattern: RegExp): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path, pattern);
    else if (pattern.test(entry.name)) yield path;
  }
}

const rel = (distDir: string, path: string) => relative(distDir, path).replaceAll("\\", "/");

export interface OnnxruntimeReport {
  /** Pages, other than the allowed ones, that can load the engine, with the file that holds it. */
  strayPages: string[];
  /** Allowed pages that do not reach the engine: the check itself would be blind. */
  missing: string[];
  /** Every .wasm file that holds the engine. */
  wasmCopies: string[];
  ok: boolean;
}

export function checkOnnxruntimePages(distDir: string): OnnxruntimeReport {
  const holds = new Map<string, boolean>();
  const holdsEngine = (file: string) => {
    let known = holds.get(file);
    if (known === undefined) {
      known =
        /\.m?js$/.test(file) &&
        readFileSync(join(distDir, file)).toString("latin1").includes(ONNXRUNTIME_SIGNATURE);
      holds.set(file, known);
    }
    return known;
  };

  const strayPages: string[] = [];
  const reached = new Set<string>();
  for (const path of walk(distDir, /\.html$/)) {
    const page = rel(distDir, path);
    const html = readFileSync(path, "utf8");
    const scripts = [
      ...findIslands(html).map((island) => island.component),
      ...[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1] ?? ""),
    ];
    for (const url of scripts) {
      const entry = resolveUrl(url, page);
      if (!entry) continue;
      const found = [...reach(distDir, entry, { dynamic: true, assets: true })].find(holdsEngine);
      if (!found) continue;
      if (ONNXRUNTIME_PAGES.includes(page)) reached.add(page);
      else strayPages.push(`${page} (${found})`);
      break;
    }
  }

  const wasmCopies = [...walk(distDir, /\.wasm$/)]
    .filter((path) => readFileSync(path).toString("latin1").includes("onnxruntime::"))
    .map((path) => rel(distDir, path))
    .sort();

  const missing = ONNXRUNTIME_PAGES.filter((page) => !reached.has(page));
  return {
    strayPages: strayPages.sort(),
    missing,
    wasmCopies,
    ok:
      strayPages.length === 0 &&
      missing.length === 0 &&
      wasmCopies.length === 1 &&
      wasmCopies[0] === ONNXRUNTIME_WASM_PATH,
  };
}

export function formatOnnxruntimeReport(report: OnnxruntimeReport): string {
  if (report.ok) {
    return `ONNX Runtime: only ${list(ONNXRUNTIME_PAGES.map((page) => `/${page.replace(/index\.html$/, "")}`))} can load it, and its wasm is the one unmodified ${ONNXRUNTIME_WASM_PATH} (ADR 0066).`;
  }
  const lines = ["ONNX Runtime (ADR 0066):"];
  for (const page of report.strayPages) {
    lines.push(`  ${page} can load ONNX Runtime; only the AI tools may.`);
  }
  for (const page of report.missing) {
    lines.push(
      `  ${page} does not reach ONNX Runtime, so this check cannot see it: update the signature.`,
    );
  }
  if (report.wasmCopies.length !== 1 || report.wasmCopies[0] !== ONNXRUNTIME_WASM_PATH) {
    const found = report.wasmCopies.length === 0 ? "none" : report.wasmCopies.join(", ");
    lines.push(
      `  expected the engine's wasm once, at ${ONNXRUNTIME_WASM_PATH}, and found: ${found}. Import "onnxruntime-web/wasm", which astro.config.mjs points at the build that loads its wasm from a URL.`,
    );
  }
  return lines.join("\n");
}
