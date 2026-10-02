// The data files PDF.js fetches at run time by a fixed name from a base URL (ADR 0057): its
// WebAssembly image decoders, the standard fonts, the CMaps and the ICC profile, copied from the
// installed `pdfjs-dist` at build time and served from our own origin, so no CDN and no CSP
// change. Each folder's LICENSE files are served with it, word for word. The version is in the
// path, so a new PDF.js never reads the files of an old one. `quickjs-eval` (PDF scripting) is not
// copied: PDF to JPG never runs a PDF's scripts.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { APIRoute, GetStaticPaths } from "astro";
import { PDFJS_VENDOR_FOLDERS } from "../../../config/pdfjs";

type Props = { file: string };

const TYPES: Record<string, string> = {
  wasm: "application/wasm",
  ttf: "font/ttf",
  pfb: "application/octet-stream",
  bcmap: "application/octet-stream",
  icc: "application/vnd.iccprofile",
};

/** `tools/` depends on pdfjs-dist; the build runs from `apps/web`. */
const packageRoot = () => resolve(process.cwd(), "../../tools/node_modules/pdfjs-dist");

export const getStaticPaths = (() => {
  const root = packageRoot();
  return PDFJS_VENDOR_FOLDERS.flatMap(({ folder, include }) =>
    readdirSync(resolve(root, folder))
      .filter((name) => include.test(name))
      .map((name) => ({
        params: { path: `${folder}/${name}` },
        props: { file: resolve(root, folder, name) },
      })),
  );
}) satisfies GetStaticPaths;

export const GET: APIRoute<Props> = ({ props }) => {
  const extension = /\.([a-z0-9]+)$/i.exec(props.file)?.[1]?.toLowerCase() ?? "";
  const type = TYPES[extension] ?? (extension === "" ? "text/plain; charset=utf-8" : "");
  return new Response(readFileSync(props.file), {
    headers: { "Content-Type": type || "application/octet-stream" },
  });
};
