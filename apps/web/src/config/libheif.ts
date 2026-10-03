// Where libheif's WebAssembly is served on this site (ADR 0060). The route
// `pages/vendor/libheif/[...path].ts` copies it, unmodified and as its own file, from the installed
// libheif-js, so a visitor can see it is the published build and replace it.

/** Matches `libheif-js` in tools/package.json. A test keeps the two in step. */
export const LIBHEIF_VERSION = "1.23.2";

export const LIBHEIF_BASE = `/vendor/libheif/${LIBHEIF_VERSION}/`;

/** Package path to published name. The LICENSE goes with the binary, as `.txt`. */
export const LIBHEIF_FILES = {
  "libheif-wasm/libheif.wasm": "libheif.wasm",
  "libheif-wasm/LICENSE": "LICENSE.txt",
} as const;
