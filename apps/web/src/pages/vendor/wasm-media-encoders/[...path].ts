// LAME's WebAssembly for the MP3 tools (ADR 0064), copied from the installed wasm-media-encoders at
// build time and served from our own origin, unmodified and as a separate file: LAME is
// LGPL-2.0-or-later, and keeping the library a file of its own lets anyone replace it. The
// package's LICENSE is served with it, word for word. The version is in the path, so a new build never reads an old file.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { APIRoute, GetStaticPaths } from "astro";
import { LAME_FILES, LAME_PACKAGE_VERSION } from "../../../config/lame";

type Props = { file: string };

/** `tools/` depends on wasm-media-encoders; the build runs from `apps/web`. */
const packageRoot = () => resolve(process.cwd(), "../../tools/node_modules/wasm-media-encoders");

export const getStaticPaths = (() =>
  Object.entries(LAME_FILES).map(([from, to]) => ({
    params: { path: `${LAME_PACKAGE_VERSION}/${to}` },
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
