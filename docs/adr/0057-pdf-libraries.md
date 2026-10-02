# 0057. PDF libraries: pdf-lib 1.17.1 and pdfjs-dist, with a Zlib exception for pako

Status: Accepted
Date: 2026-10-02

## Context

Tools batch 2 adds PDF tools that run on the visitor's device: image-to-pdf, merge-pdf, split-pdf,
rotate-pdf, sign-pdf (writing PDFs) and pdf-to-jpg (drawing PDF pages). Writing a PDF by hand is not
realistic, so the tools need a library to write PDFs and a library to render them. `logic.ts` stays
pure: the libraries are used only from each tool's `worker.ts`, which starts on the visitor's first
job, so they are on-demand JavaScript (ADR 0037) and nothing of them loads with the page. Not from
`ui.tsx` behind a dynamic `import()`: that makes Vite move its preload helper into a chunk the
search loader shares, so every page would load it, and `pnpm check:budgets` fails (ADR 0046).

Facts were checked on 2026-10-02 on the npm registry, GitHub and the GitHub advisory database.

### Writing PDFs

- `pdf-lib` 1.17.1, MIT. No release since November 2021; the upstream repository was last pushed in
  July 2024. No GitHub advisory. Dependencies: `@pdf-lib/standard-fonts` 1.0.0 and `@pdf-lib/upng`
  1.0.1 (MIT), `pako` 1.0.11 (`(MIT AND Zlib)`), `tslib` 1.14.1 (0BSD).
- `@cantoo/pdf-lib` 2.11.1, MIT, a maintained fork (released 2026-09-15), no GitHub advisory. It can
  open password-protected PDFs.

The fork is **rejected** because its published build cannot be verified against its source. The
2.11.1 tarball names `gitHead` `c8c88e84dcd5510ec35921123bb5140fe02a7115`; that commit does not
exist in `github.com/cantoo-scribe/pdf-lib` (the API answers "No commit found for SHA", and a fetch
answers "not our ref"), and there is no 2.11.1 tag. Two issues about the package are open and
unanswered by the maintainers: #168 (Socket reports the 2.11.x package as obfuscated; the reporter
suspects commit a9e0f4a, which vendored compressed font data and replaced pako with fflate) and #159
(the published `package.json` carries `"prepare": "husky"` since 2.11.0). The cause of the Socket
report is not explained, so the fork is not used.

### Rendering PDFs

`pdfjs-dist` 6.3.289, Apache-2.0, released 2026-08-29 by Mozilla. The most recent advisory,
GHSA-hq66-cqwq-w95j (arbitrary JavaScript when a malicious PDF is opened), affects 5.6.83 to
6.2.107 and is fixed in 6.2.108; 6.3.289 has no open advisory. It is used with
`isEvalSupported: false`, and its worker is a file served from our own origin. Its optional
dependency `@napi-rs/canvas` (MIT) is for Node only and never reaches a page.

### pako and the Zlib licence

`pako` 1.0.11 is licensed `(MIT AND Zlib)`: the zlib port inside it keeps the zlib licence of Jean-loup
Gailly and Mark Adler. Zlib is a permissive licence: use, change and redistribution are allowed,
including commercially, provided the origin is not misrepresented and the notice is kept. It is not
in `ALLOWED_LICENSES`, so `pnpm check:licenses` failed.

## Decision

1. Use `pdf-lib` 1.17.1 (not the fork) for writing PDFs and `pdfjs-dist` 6.3.289 for rendering,
   both at exact versions in `tools/package.json`.
2. Allow the Zlib licence for `pako` 1.0.11 only, as a package- and version-scoped entry in
   `LICENSE_EXCEPTIONS` (`scripts/lib/licenses.ts`). Zlib is **not** added to `ALLOWED_LICENSES`; a
   test proves that any other package, or another pako version, with Zlib is still rejected.
3. We keep the notice and do not claim the code as ours: `apps/web/src/config/credits.ts` lists
   pdf-lib, pako and pdf.js with their licences and the full zlib notice, and the About page shows
   them. The minifier drops licence comments from the bundles, so the notice lives on the page: an E2E
   test (`site.spec.ts`) checks that the built About page still carries the zlib notice and that
   the licence files are served.
4. PDF.js fetches data files by a fixed name from a base URL: its WebAssembly image decoders
   (OpenJPEG, PDFium JBIG2, qcms), standard fonts (Foxit, Liberation), CMaps (Adobe) and an ICC
   profile. The route `apps/web/src/pages/vendor/pdfjs/[...path].ts` copies them from the installed
   package at build time to `/vendor/pdfjs/<version>/`, with every LICENSE file of those folders
   served word for word; the About page links them. All are permissive (BSD, Apache-2.0, MIT,
   OFL-1.1, CC0-1.0); none is over 1 MB. `quickjs-eval` (PDF scripting) is not copied.
5. Password-protected PDFs are not supported: pdf-lib 1.17.1 cannot decrypt them, so the tools
   refuse them with a plain message. Damaged PDFs that a library cannot read are refused with a
   plain message too.

Sizes, measured as the libraries ship (minified ESM, gzip -9): pdf-lib 201 KB, pdf.js 127 KB plus
its worker 365 KB. The sizes per tool page measured by `pnpm check:budgets` are in the pull request.
They are under the default on-demand budget of 1,024 KB (ADR 0037).

## Consequences

- pdf-lib gets no fixes upstream. If an advisory appears, or a needed fix exists only in a fork,
  write a new ADR; the fork can be reconsidered once its published builds match a public commit.
- Removing pdf-lib removes pako 1.0.11; then delete the exception and its test.
- No CSP change: the pdf.js worker is `'self'`, and `worker-src 'self' blob:` already allows it.
