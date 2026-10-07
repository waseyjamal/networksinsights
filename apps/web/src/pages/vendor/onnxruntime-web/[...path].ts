// ONNX Runtime Web's WebAssembly backend for the AI image tools (ADR 0066), copied from the
// installed onnxruntime-web at build time and served from our own origin, unmodified. The worker
// imports the `.mjs` loader and fetches the `.wasm` from here, so the 14 MB engine never enters a
// page bundle. The version is in the path, so a new build never reads an old file.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { APIRoute, GetStaticPaths } from "astro";
import { ONNXRUNTIME_FILES, ONNXRUNTIME_VERSION } from "../../../config/onnxruntime";

type Props = { file: string };

/** `tools/` depends on onnxruntime-web; the build runs from `apps/web`. */
const packageRoot = () => resolve(process.cwd(), "../../tools/node_modules/onnxruntime-web");

const TYPES = {
  wasm: "application/wasm",
  mjs: "text/javascript; charset=utf-8",
} as const;

export const getStaticPaths = (() =>
  Object.entries(ONNXRUNTIME_FILES).map(([from, to]) => ({
    params: { path: `${ONNXRUNTIME_VERSION}/${to}` },
    props: { file: resolve(packageRoot(), from) },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<Props> = ({ props }) =>
  new Response(readFileSync(props.file), {
    headers: { "Content-Type": props.file.endsWith(".wasm") ? TYPES.wasm : TYPES.mjs },
  });
