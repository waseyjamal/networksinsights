// Tesseract's files for OCR (ADR 0060): the tesseract.js worker script, the LSTM-only engine of
// tesseract.js-core and the language data, copied from the installed packages at build time and
// served unmodified from our own origin, so no CDN and no CSP change. Their licences are served
// with them, word for word. The version is in the path, so a new build never reads an old file.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { APIRoute, GetStaticPaths } from "astro";
import { TESSERACT_FILES, TESSERACT_VERSION } from "../../../config/tesseract";

type Props = { file: string; published: string };

const TYPES: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  wasm: "application/wasm",
  gz: "application/gzip",
  txt: "text/plain; charset=utf-8",
};

/** `tools/` depends on the packages; the build runs from `apps/web`. */
const installed = (name: string, path: string) =>
  resolve(process.cwd(), "../../tools/node_modules", name, path);

export const getStaticPaths = (() =>
  Object.entries(TESSERACT_FILES).map(([to, [name, path]]) => ({
    params: { path: `${TESSERACT_VERSION}/${to}` },
    props: { file: installed(name, path), published: to },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<Props> = ({ props }) => {
  const extension = /\.([a-z0-9]+)$/i.exec(props.published)?.[1] ?? "";
  return new Response(readFileSync(props.file), {
    headers: { "Content-Type": TYPES[extension] ?? "application/octet-stream" },
  });
};
