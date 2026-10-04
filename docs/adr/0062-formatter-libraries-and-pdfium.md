# 0062. Formatter libraries loaded from workers, and PDFium for Compress PDF

Status: Accepted
Date: 2026-10-04

## Context

Tools batch 5C adds four tools that work on the visitor's device:

- `yaml-formatter` formats, validates and minifies YAML.
- `xml-formatter` formats and minifies XML and checks that it is well formed.
- `sql-formatter` formats SQL for the dialect the visitor picks.
- `compress-pdf` makes a PDF smaller by recompressing its pictures, keeping its text.

`logic.ts` may import only `zod` and the SDK (AGENTS.md). The formatter libraries are tens of
kilobytes each, and the PDF engine is megabytes, so none of them may reach a page's initial
JavaScript (40 KB gzip, ADR 0037).

Facts were checked on 2026-10-04 on the npm registry, GitHub and the packages themselves. Sizes
are esbuild minified bundles, gzip -9.

| Package | Version | Released | Licence | On demand, gzip |
|---|---|---|---|---|
| `yaml` | 2.9.1 | 2026-09-11 | ISC, no dependencies | 30 KB |
| `xml-formatter` (with `xml-parser-xo` 4.1.6, 2026-05-21, MIT) | 3.7.0 | 2026-03-13 | MIT | 2.5 KB |
| `sql-formatter`, every dialect | 15.9.0 | 2026-09-23 | MIT | 76 KB |
| `@embedpdf/pdfium` | 2.15.1 | 2026-09-16 | MIT | 38 KB JS + 2.1 MB wasm |

`sql-formatter` depends on `nearley` 2.20.1 (MIT), `moo` 0.5.3 (BSD-3-Clause), `commander`
2.20.3 (MIT), `randexp` 0.4.6, `ret` 0.1.15 and `discontinuous-range` 1.0.0 (MIT),
`railroad-diagrams` 1.0.0 (CC0-1.0) and `argparse` 2.0.1 (Python-2.0, used only by its command
line). Every licence is in the allowed set; `pnpm check:licenses` passes. None needs a build script.

## Decision

### The formatters run in a worker; the purity allowlist does not change

Each formatter tool has `runtime: "worker"`. `worker.ts` imports the library, so it is fetched only
when the worker starts, at the visitor's first text. `logic.ts` stays pure: its formatting function
takes the library as a parameter (`formatYaml(yaml, input)`, `formatXml`, `formatSql`), typed by
the shape it uses, and imports nothing. The unit tests pass it the real library, so the output the
pages show is tested.

The alternatives were rejected. Adding the libraries to the purity allowlist would make them static
imports of `logic.ts`, which `tool.config.ts` and `ui.tsx` import, and put them in the initial
JavaScript. A dynamic `import()` in `ui.tsx` makes Vite share its preload helper with the search
loader, which `pnpm check:budgets` fails (ADR 0057).

`sql-formatter` ships all its 20 dialects (the library's `tsql` key is another name for
`transactsql`); the page lists exactly those. The formatters stay under the default on-demand
budget of 1024 KB, so they set no `budget`.

The YAML tool parses with the `failsafe` schema, so every scalar is printed as the text it was
written as: `007`, `0x1F`, `1e5` and long integers are not changed by a round trip. `xml-formatter`
accepts XML that is not well formed (a missing end tag, an unquoted attribute), so `logic.ts` checks
well-formedness first, in pure code, and only well-formed XML is printed.

### PDFium for Compress PDF

`@embedpdf/pdfium` is PDFium, the PDF engine of Chrome, compiled to WebAssembly, with a call
`EPDFImageObj_SetJpeg` that replaces the data of a picture. A prototype in Chromium (2026-10-04, UTC)
compressed a 7-page, 20.6 MB PDF with six 3000 × 2000 photos and one picture with transparency
to 1.55 MB at 150 dpi; PDF.js read the same text from every page before and after, and the
transparent picture was left alone. An encrypted PDF is refused (PDFium error 4), and a PDF of text
only came out larger, so it is not offered.

The worker skips a picture with transparency or a mask (found by rendering it with its mask and
reading the alpha), over 25 megapixels, under 8 bits a pixel, or in CMYK or a separation colour
space. A new JPEG replaces a picture only when it is at most 90% of the bytes. After saving, it
opens the new file and compares the text of every page with the original's; if any page differs,
no file is returned. A file that is not smaller is never offered.

The `.wasm` file is not copied to `/vendor/`. The package's browser build loads it with
`new URL('pdfium.wasm', import.meta.url)`, so Vite already emits it unmodified as a content-hashed
file under `/_astro/`, cached for a year like every hashed file (ADR 0048). A second copy under
`/vendor/` would double 4.6 MB in every deploy. The file is under Cloudflare's 25 MiB limit.
`check:budgets` counts it, so the tool sets `budget.maxOnDemandJsKb: 2300` with its reason.

WebAssembly is already allowed by the site's CSP for HEIC to JPG and OCR; nothing changes in it.

### FreeType under the FTL, not the GPLv2

PDFium's WebAssembly contains FreeType 2.14.1, which is offered under the FreeType License (FTL)
or the GNU GPL version 2, at the user's choice. This site uses it under the FTL. The GPLv2 is not
allowed (AGENTS.md, license rule). The FTL's condition for a binary distribution, a statement in
the documentation that the software is based in part on the work of the FreeType Team, and the
credit line FTL.TXT recommends are in `FREETYPE_NOTICE` in `apps/web/src/config/credits.ts`, shown
on the About page; a test checks both.

The other libraries inside PDFium's WebAssembly (from the `embedpdf/runtime` fork at 0ba3b64) are
Little CMS (MIT), OpenJPEG (BSD-2-Clause), libjpeg-turbo (IJG and BSD-3-Clause), libpng (PNG
Reference Library License 2), zlib (Zlib) and Anti-Grain Geometry 2.3 (a permissive notice). Their
notices, including the IJG statement, are credited the same way. PDFium itself is BSD-3-Clause,
with parts under Apache-2.0.

## Consequences

- Four exact dependencies in `tools/package.json`. The YAML, XML and SQL libraries load only in
  their workers; PDFium loads only when a visitor presses Compress.
- `credits.ts` gains the formatter libraries, `@embedpdf/pdfium`, PDFium, FreeType and the
  libraries inside PDFium.
- No change to the purity allowlist, the licence allowlist, the CSP or `versionedVendorPaths`.
- An update of `@embedpdf/pdfium` must recheck which libraries its WebAssembly contains and the
  FreeType version, and keep FreeType under the FTL.
