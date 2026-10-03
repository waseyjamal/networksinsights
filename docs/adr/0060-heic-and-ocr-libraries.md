# 0060. HEIC and OCR libraries: libheif-js (LGPL-3.0 exception) and tesseract.js

Status: Accepted
Date: 2026-10-04

## Context

Tools batch 5A adds two tools that run on the visitor's device:

- `heic-to-jpg` turns the HEIC and HEIF photos of iPhones and iPads into JPG or PNG.
- `ocr` reads printed English and Hindi from a photo or a PDF.

Neither can be written by hand. The browsers' own decoders read HEIC only in Safari, and they have
no OCR at all. Both libraries are used only from each tool's `worker.ts`, so they are on-demand
code (ADR 0037) and nothing of them loads with the page.

Facts were checked on 2026-10-03 on the npm registry, GitHub, webkit.org and the Tesseract
documentation.

### HEIC: libheif-js 1.23.2

- `libheif-js` 1.23.2 was released on 2026-09-05 and is licensed `LGPL-3.0`. It is an Emscripten
  build of libheif, with libde265 for HEVC, and both are LGPL-3.0 (Struktur AG, Dirk Farin).
- It has no runtime dependencies.
- The `libheif-wasm` variant ships a 91 KB loader (`libheif.js`, 29 KB gzip) and a 1,422 KB
  `libheif.wasm` (469 KB gzip).
- The bundled variants (`wasm-bundle`, `libheif-bundle.mjs`) put the wasm inside the JavaScript, so
  the library could not be replaced on its own. They are not used.
- `heic-to` 1.6.5 is the same libheif under LGPL-3.0, at 25.9 MB unpacked. `heic2any` 0.0.4 (MIT)
  has had no release since 2023 and embeds an older libheif compiled to JavaScript, whose own
  licence is LGPL. Neither is better.
- **Safari:** WebKit's "WebKit Features in Safari 17.0" says Safari 17 decodes HEIC natively
  (https://webkit.org/blog/14445/webkit-features-in-safari-17-0/). No other engine says so on an
  official source, so the browser's decoder is only the fallback when libheif fails.

### OCR: tesseract.js 7.0.0

- `tesseract.js` 7.0.0 and `tesseract.js-core` 7.0.0 were both released on 2025-12-15 and are
  licensed Apache-2.0. tesseract.js-core is Tesseract with Leptonica, compiled to WebAssembly.
- Their dependencies are MIT or Apache-2.0: bmp-js, idb-keyval, is-url, node-fetch,
  regenerator-runtime, wasm-feature-detect, zlibjs.
- Its `opencollective-postinstall` build script is denied in `allowBuilds`.
- By default tesseract.js fetches its worker, its core and the language data from jsDelivr. Here
  all three come from our own origin.

The language data was compared on Tesseract's own documentation (tessdoc, "Data Files"):

| Set | English (gzip) | Hindi (gzip) | Tesseract's words |
|---|---|---|---|
| `tessdata_best` (float) | 12.8 MB | 11.3 MB | "Most accurate", "Slowest"; "for people willing to trade a lot of speed for slightly better accuracy" |
| integer version of `tessdata_best` (chosen) | 2.95 MB | 1.39 MB | the LSTM models of `tessdata`, "slightly less accurate than tessdata-best" |
| `tessdata_fast` | 4.1 MB raw | 1.1 MB raw | "Least accurate" |

The integer files are the ones `@tesseract.js-data/eng` and `/hin` 1.0.0 publish as
`4.0.0_best_int`. They are the data tesseract.js uses by default. The packaging is MIT and the data
is Apache-2.0.

## Decision

1. **Exact versions.** Use `libheif-js` 1.23.2, `tesseract.js` 7.0.0, `tesseract.js-core` 7.0.0,
   `@tesseract.js-data/eng` 1.0.0 and `@tesseract.js-data/hin` 1.0.0, at exact versions in
   `tools/package.json`.
2. **The LGPL-3.0 exception, approved by the owner for libheif-js only.**
   - It is an entry in `LICENSE_EXCEPTIONS` (`scripts/lib/licenses.ts`) for `libheif-js` 1.23.2
     only. LGPL-3.0 is **not** added to `ALLOWED_LICENSES`.
   - A test proves that any other package with LGPL, and another libheif-js version, are still
     rejected.
   - **Why LGPL-3.0 is acceptable here.** The LGPL lets a program of any licence use the library,
     provided the library stays replaceable and its source is offered:
     - The wasm, which is libheif and libde265, is served unmodified, byte for byte as published,
       as its own file at `/vendor/libheif/1.23.2/libheif.wasm`. A visitor or a developer can
       replace it with their own build.
     - The Emscripten loader that calls it is bundled into the tool's worker. A replacement must
       be a libheif-js build with the same interface.
     - The licence text is served next to the wasm (`LICENSE.txt`). The About page names libheif,
       libde265 and libheif-js with the LGPL notice and links to their complete source.
     - The minifier drops comments, so the notice lives on the page.
   - **HEVC patents are a separate risk, which the owner accepts.** HEIC photos are coded with HEVC
     (H.265), which is covered by patent pools. The LGPL licenses copyright only, not patents.
     Decoding HEVC in software in the visitor's browser may need a patent licence in some
     countries. This site takes no licence and charges nothing for the tool. The owner has accepted
     that risk.
3. **Self-hosted files, no CDN.** Two routes copy the files from the installed packages at build
   time, as the PDF.js route does (ADR 0057). Each file is served unmodified, with the version in
   its path.
   - `pages/vendor/libheif/[...path].ts` serves `libheif.wasm` and its licence.
   - `pages/vendor/tesseract/[...path].ts` serves the tesseract.js worker script, the core with and
     without SIMD (script and wasm), `eng.traineddata.gz`, `hin.traineddata.gz` and both licences.
   - The core is the full build, run in LSTM mode, not the smaller LSTM-only build (1,058 KB gzip
     against 1,296 KB). With the Hindi data, the LSTM-only build prints a console error for each of
     two legacy parameters the data names and that build does not know. The full build knows them,
     so the page stays free of console errors.
   - The largest file is 2.95 MB, under Cloudflare's 25 MiB limit for one file. A test checks
     every file against that limit.
   - The tool's worker picks the core with wasm-feature-detect's SIMD probe. Only the language
     files the visitor chooses are fetched. `cacheMethod: "none"` keeps tesseract.js from writing
     to IndexedDB, so the browser's HTTP cache is the only copy.
4. **Tesseract runs in a worker of its own, started from the tool's worker.** Nested dedicated
   workers are supported by Chromium, Firefox and Safari (15.5 and later). The E2E spec read real
   text in Chromium and Firefox, and the nested worker loaded the engine and read text in
   Playwright's WebKit too. The runtime stays `worker`; had one engine failed, OCR would have moved
   to the page (runtime `client`), as the owner asked.
   - Playwright's WebKit build for Windows has no `OffscreenCanvas` in workers, so OCR, HEIC to JPG
     and PDF to JPG cannot finish there. CI runs WebKit on Linux, which has it, and so does Safari
     from 16.4.
5. **PDF pages for OCR** are drawn by PDF.js in the tool's worker at 300 dpi, within 4,000 pixels,
   as ADR 0057 says.
6. **The OCR page's on-demand budget is raised to 2,048 KB**, with its reason in the manifest, as
   the owner approved.
   - `pnpm check:budgets` counts the worker chunk, about 488 KB with PDF.js inside.
   - The vendored files are fetched by URL, so the gate does not count them. On first use they add
     the core (24 KB script plus 1,296 KB wasm, gzip) and the language data (2.95 MB English,
     1.39 MB Hindi, already gzip).
   - The pull request lists every number.
7. **No CSP change.**
   - Every file comes from `'self'`.
   - Workers are `'self'`, which `worker-src 'self' blob:` allows, and `workerBlobURL: false` keeps
     tesseract.js from using a blob worker.
   - `'wasm-unsafe-eval'` is already in `script-src`.

## Consequences

- **Upgrades.** A new libheif-js version fails `pnpm check:licenses` until the exception names it,
  so each upgrade is a decision. Removing libheif-js removes the exception and its test.
- **Pages state real numbers.** The OCR page shows the real sizes of the files it downloads, and a
  test compares them with the installed files. It states no accuracy figure: Tesseract publishes
  none for these files, and only says that Hindi and blurred photos read less well.
- **Later option: tessdata_best float.** It could become an optional "best quality" mode, at
  12.8 MB for English and 11.3 MB for Hindi, each under 25 MiB. It is slower on phones and needs a
  new decision on its size.
