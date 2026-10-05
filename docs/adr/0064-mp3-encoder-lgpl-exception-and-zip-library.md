# 0064. The MP3 encoder (LAME, a scoped LGPL exception) and the ZIP library (fflate)

Status: Accepted; supersedes the "No MP3" rule of [0061](0061-media-libraries-and-vendor-cache.md)
Date: 2026-10-05

## Context

Tools batch 6B adds `video-to-mp3`, `audio-to-mp3`, `zip-create-extract` and `edit-pdf`. Edit PDF
uses only the PDF libraries of ADR 0057. The other three need new code that runs on the visitor's
device, and that code is used only from each tool's `worker.ts`, so it is on-demand code (ADR 0037)
and nothing of it loads with the page.

Browsers have no MP3 encoder, and every free MP3 encoder is built on LAME, which is LGPL. ADR 0061
kept MP3 out for that reason. The owner approved an exception for one MP3 encoder package only, on
four conditions: a check:licenses exception scoped to that exact package and version, with a test
that any other LGPL package is still rejected; the encoder served as its own separate, unmodified
file, so it can be replaced; an LGPL notice and a link to the source in the About page credits; and
this ADR.

Facts were checked on 2026-10-05 on the npm registry, the GitHub repositories named below,
lame.sourceforge.io and fraunhofer.de.

### MP3: the options

| Package | Version, date | Licence declared | How LAME ships | Replaceable |
|---|---|---|---|---|
| `wasm-media-encoders` | 0.7.0, 2024-05-24 | MIT | `wasm/mp3.wasm`, a separate file (133 KB, 66 KB gzip); the main entry also inlines it as base64 | Yes: `createEncoder("audio/mpeg", url)` loads the separate file |
| `@mediabunny/mp3-encoder` | 1.61.0; 1.61.1 is 2 days old, under `minimumReleaseAge` | MPL-2.0 | wasm as base64 inside `build/lame.js`, and the worker bundled inside the JavaScript | No |
| `lamejs` / `@breezystack/lamejs` | 1.2.1 (2022) / 1.2.7 (2025-01) | LGPL-3.0 | A JavaScript port of LAME | Yes, but an unmaintained port, slower than wasm |

`wasm-media-encoders` 0.7.0 is chosen: it is the cleanest to relink. Its JavaScript (MIT, about
1.9 KB gzip) goes into the tools' workers; LAME stays in `mp3.wasm`, fetched at run time.
Its only dependency is `@swc/helpers` (Apache-2.0, 0.5.23 resolved), which depends on `tslib`
(0BSD).

### What is inside mp3.wasm

- **LAME version:** 3.100. The package's Git submodule `src/wasm/lame/lame-src` at tag `v0.7.0`
  points at commit `98db548e8e851defbba3184125ce10725355c332` of https://github.com/arseneyr/lame,
  whose `libmp3lame/version.h` says major 3, minor 100, patch 0.
- **The fork's patches:** that commit is one commit, "disabling printf" (2020-12-22), on top of
  "tag 3.100 release" (`RELEASE__3_100` from LAME's own Subversion). Both are published in that
  repository: https://github.com/arseneyr/lame/commits/98db548e8e851defbba3184125ce10725355c332.
- **Build flags:** the package's Makefile configures LAME with `--disable-decoder`,
  `--disable-frontend`, `--disable-shared`, `--disable-analyzer-hooks` and `--disable-gtktest`,
  with `CFLAGS="-DNDEBUG -DNO_STDIO"`
  (https://github.com/arseneyr/wasm-media-encoders/blob/v0.7.0/Makefile). The decoder is off,
  so mpglib, which LAME's licence page says is GPL, is not in the file; no `mpglib` or `hip_`
  string is in it either.
- **Licence:** LAME's `COPYING` at that commit is the GNU Library General Public License version 2,
  and the source headers say "version 2 of the License, or (at your option) any later version":
  LGPL-2.0-or-later. https://lame.sourceforge.io/license.txt asks users to acknowledge LAME and
  link to its website.

### MP3 patents

Fraunhofer IIS states: "On April 23, 2017, Technicolor's mp3 licensing program for certain mp3
related patents and software of Technicolor and Fraunhofer IIS has been terminated"
(https://www.iis.fraunhofer.de/en/ff/amm/consumer-electronics/mp3.html). That is all this ADR
verified. It did not verify that no MP3 patent is in force anywhere; the owner accepts any
remaining risk.

### ZIP: fflate 0.8.3

`fflate` 0.8.3 was released on 2026-05-16 under MIT, with no dependencies. The ZIP tool uses its
streaming `Zip`, `ZipDeflate`, `ZipPassThrough` and `Inflate` classes: about 8 KB gzip in the
worker. The tool reads a ZIP's central directory itself (in `logic.ts`, which imports nothing), so
it can refuse encrypted, ZIP64 and oversized archives before anything is unpacked, and it inflates
one file at a time, stopping as soon as a file grows past its declared size.

## Decision

- **The LGPL exception is scoped:** `scripts/lib/licenses.ts` overrides the licence of
  `wasm-media-encoders` (every version) to `MIT AND LGPL-2.0-or-later`, because its declared MIT
  leaves out LAME, and allows `LGPL-2.0-or-later` for that package at version 0.7.0 only.
  `ALLOWED_LICENSES` is unchanged. Tests check that 0.7.1, a lookalike name, and lamejs,
  `@breezystack/lamejs`, `@mediabunny/mp3-encoder` under any LGPL version are all rejected.
- **Relinkable:** `pages/vendor/wasm-media-encoders/[...path].ts` copies `wasm/mp3.wasm` and the
  package's `LICENSE` unmodified to `/vendor/wasm-media-encoders/0.7.0/` at build time, as libheif's
  are (ADR 0060). It is a versioned vendor folder (ADR 0061): cached for a year, and checked by
  `pnpm check:production`. The tools load it only with `createEncoder("audio/mpeg", url)`, never
  with `createMp3Encoder`, which would inline a second copy.
- **One copy, proved on every build:** `pnpm check:budgets` scans every script, wasm, page and data
  file of the build, raw and inside base64 runs, for strings LAME compiles into its encoder. It
  fails unless exactly one file holds LAME: `vendor/wasm-media-encoders/0.7.0/mp3.wasm`
  (`scripts/lib/lame-copies.ts`, tested against the package's own inlined build).
- **Credits:** the About page credits LAME 3.100 under LGPL-2.0-or-later, with links to
  https://lame.sourceforge.io/, the fork at the exact commit, its `COPYING`, and the package at tag
  `v0.7.0`; `@swc/helpers` and `fflate` are credited too.
- No header or CSP change: `script-src` already has `'wasm-unsafe-eval'` and the wasm is fetched
  from our own origin.

## Consequences

- MP3 output is possible. Video to MP3 and Audio to MP3 decode with Mediabunny and the browser's
  WebCodecs decoder (ADR 0061); only PCM needs no decoder, so WAV to MP3 works in every browser.
- Another MP3 encoder, another version of this one, or any other LGPL package needs a new ADR.
- A new version of `wasm-media-encoders` changes the vendor path, the override test, the credit and
  this ADR's facts together.
- The pages of Video to audio and Audio converter no longer say MP3 is refused for its licence;
  they point to the new tools.
