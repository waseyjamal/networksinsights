// Where Tesseract's files are served on this site (ADR 0060). The route
// `pages/vendor/tesseract/[...path].ts` copies them, unmodified, from the installed packages: the
// tesseract.js worker script, the cores of tesseract.js-core (with and without SIMD; the worker
// picks one) and the English and Hindi language data (integer versions of tessdata_best).
// No CDN: tesseract.js would fetch all of these from jsDelivr by default.

/** Matches `tesseract.js` in tools/package.json. A test keeps the two in step. */
export const TESSERACT_VERSION = "7.0.0";

export const TESSERACT_BASE = `/vendor/tesseract/${TESSERACT_VERSION}/`;

/** Published name to `[package, path in the package]`. */
export const TESSERACT_FILES = {
  "worker.min.js": ["tesseract.js", "dist/worker.min.js"],
  "LICENSE-tesseract.js.txt": ["tesseract.js", "LICENSE.md"],
  "tesseract-core.js": ["tesseract.js-core", "tesseract-core.js"],
  "tesseract-core.wasm": ["tesseract.js-core", "tesseract-core.wasm"],
  "tesseract-core-simd.js": ["tesseract.js-core", "tesseract-core-simd.js"],
  "tesseract-core-simd.wasm": ["tesseract.js-core", "tesseract-core-simd.wasm"],
  "LICENSE-tesseract.js-core.txt": ["tesseract.js-core", "LICENSE"],
  "lang/eng.traineddata.gz": ["@tesseract.js-data/eng", "4.0.0_best_int/eng.traineddata.gz"],
  "lang/hin.traineddata.gz": ["@tesseract.js-data/hin", "4.0.0_best_int/hin.traineddata.gz"],
} as const;
