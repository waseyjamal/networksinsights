// Where ONNX Runtime Web's WebAssembly backend is served on this site (ADR 0066). The route
// `pages/vendor/onnxruntime-web/[...path].ts` copies it, unmodified and as its own files, from the
// installed onnxruntime-web. Only the plain wasm backend is served: not the WebGPU (JSEP), JSPI or
// asyncify builds. The tools run it on one thread, because the site is not cross-origin isolated.

/** Matches `onnxruntime-web` in tools/package.json. A test keeps the two in step. */
export const ONNXRUNTIME_VERSION = "1.30.0";

export const ONNXRUNTIME_BASE = `/vendor/onnxruntime-web/${ONNXRUNTIME_VERSION}/`;

/**
 * Package path to published name. The package ships no LICENSE file: its MIT notice and the
 * notices of the libraries compiled into the wasm are in `credits.ts`.
 */
export const ONNXRUNTIME_FILES = {
  "dist/ort-wasm-simd-threaded.mjs": "ort-wasm-simd-threaded.mjs",
  "dist/ort-wasm-simd-threaded.wasm": "ort-wasm-simd-threaded.wasm",
} as const;
