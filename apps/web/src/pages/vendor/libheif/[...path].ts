// libheif's WebAssembly for HEIC to JPG (ADR 0060), copied from the installed libheif-js at build
// time and served from our own origin, unmodified and as a separate file: libheif and libde265 are
// LGPL-3.0, and keeping the library a file of its own lets anyone replace it. Its LICENSE is served
// with it, word for word. The version is in the path, so a new build never reads an old file.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { APIRoute, GetStaticPaths } from "astro";
import { LIBHEIF_FILES, LIBHEIF_VERSION } from "../../../config/libheif";

type Props = { file: string };

/** `tools/` depends on libheif-js; the build runs from `apps/web`. */
const packageRoot = () => resolve(process.cwd(), "../../tools/node_modules/libheif-js");

export const getStaticPaths = (() =>
  Object.entries(LIBHEIF_FILES).map(([from, to]) => ({
    params: { path: `${LIBHEIF_VERSION}/${to}` },
    props: { file: resolve(packageRoot(), from) },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<Props> = ({ props }) =>
  new Response(readFileSync(props.file), {
    headers: {
      "Content-Type": props.file.endsWith(".wasm")
        ? "application/wasm"
        : "text/plain; charset=utf-8",
    },
  });
