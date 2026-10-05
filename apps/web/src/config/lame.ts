// Where the LAME MP3 encoder's WebAssembly is served on this site (ADR 0064). The route
// `pages/vendor/wasm-media-encoders/[...path].ts` copies it, unmodified and as its own file, from
// the installed wasm-media-encoders, so a visitor can see it is the published build and replace it.

/** Matches `wasm-media-encoders` in tools/package.json. A test keeps the two in step. */
export const LAME_PACKAGE_VERSION = "0.7.0";

export const LAME_BASE = `/vendor/wasm-media-encoders/${LAME_PACKAGE_VERSION}/`;

/** Package path to published name. The package's LICENSE (its JavaScript, MIT) goes as `.txt`. */
export const LAME_FILES = {
  "wasm/mp3.wasm": "mp3.wasm",
  LICENSE: "LICENSE.txt",
} as const;

/** The LAME source inside mp3.wasm: release 3.100 plus one fork commit ("disabling printf"). */
export const LAME_SOURCE = {
  version: "3.100",
  fork: "https://github.com/arseneyr/lame",
  commit: "98db548e8e851defbba3184125ce10725355c332",
  build: "https://github.com/arseneyr/wasm-media-encoders/blob/v0.7.0/Makefile",
} as const;
