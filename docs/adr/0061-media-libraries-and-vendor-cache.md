# 0061. Video and audio tools: Mediabunny, the libFLAC encoder and gifenc; long cache for versioned vendor folders

Status: Accepted
Date: 2026-10-04

## Context

Tools batch 5B adds four tools that work on the visitor's device:

- `video-compressor` makes a video smaller, as MP4 (H.264) or WebM (VP9).
- `video-to-audio` saves the sound of a video as M4A or WAV.
- `audio-converter` converts between WAV, FLAC, OGG Opus and M4A.
- `video-to-gif` turns up to 30 seconds of a video into a GIF.

Browsers decode and encode audio and video with WebCodecs, but they do not read or write
containers (MP4, WebM, Ogg, FLAC, WAV), and they have no FLAC or GIF encoder. The owner ruled out
MP3 and anything LGPL, GPL or LAME-based.

The same pull request makes the vendored PDF.js and libheif folders cacheable for good. Until now
they answered `public, max-age=0, must-revalidate`, as every file outside `/_astro/` does.

Facts were checked on 2026-10-04 on the npm registry, GitHub and the packages themselves.

### Mediabunny 1.61.0

- `mediabunny` is licensed `MPL-2.0`. It reads and writes MP4, WebM, Ogg, FLAC, WAV and more, and
  uses the browser's own WebCodecs encoders and decoders; it adds no codec of its own.
- 1.61.0 was released on 2026-09-29. 1.61.1 (2026-10-03) was younger than `minimumReleaseAge`
  (three days) when this was written, so it is not used.
- Its only dependencies are two type packages, `@types/dom-webcodecs` and
  `@types/dom-mediacapture-transform`, both MIT, which never reach a visitor.
- MPL-2.0 is already in the allowed set (ADR 0017, ADR 0049): a file-level copyleft that asks for
  the source of the MPL files to be available. This site serves the package unmodified, and the
  About page links its source at the release tag.

### @mediabunny/flac-encoder 1.61.0

- Licensed `MPL-2.0`, released 2026-09-29 with Mediabunny. It registers a FLAC encoder with
  Mediabunny's custom coder API.
- Inside is libFLAC, built with Emscripten (README "Building and development"). What was checked:
  - The build turns off the command line programs, the C++ library, the examples and Ogg:
    `-DBUILD_PROGRAMS=OFF -DBUILD_CXXLIBS=OFF -DWITH_OGG=OFF`. The `flac` programs are the GPL part
    of the FLAC project. The libraries, libFLAC and libFLAC++, are under Xiph's BSD-3-Clause
    licence (`README.md` and `COPYING.Xiph` in xiph/flac).
  - The bridge (`src/bridge.c`) includes only `emscripten.h`, `FLAC/stream_encoder.h` and the C
    standard headers.
  - The WebAssembly is embedded in the bundle (`SINGLE_FILE=1`) and runs in a blob worker. Its
    strings name only libFLAC (`reference libFLAC git-3f1ecff8 20260304`) and its window functions.
    There is no Ogg, no Vorbis and no other library. The JavaScript around it is Emscripten's
    runtime, MIT.
  - Nothing is LGPL or GPL.
- The About page carries the libFLAC copyright and licence word for word, as the BSD licence asks
  of a binary.

### gifenc 1.0.3

- MIT, released 2021-03-07, no dependencies. 9 KB as an ES module. It picks a 256-colour palette
  and writes GIF frames.

### Measured sizes (`pnpm check:budgets`, gzip, the tool's own code)

| Tool | Page load | On demand |
|---|---|---|
| audio-converter | 10.4 KB | 221.9 KB (with the FLAC encoder) |
| video-compressor | 11.3 KB | 140.5 KB |
| video-to-audio | 10.0 KB | 137.3 KB |
| video-to-gif | 10.2 KB | 96.3 KB |

Every tool is within the 40 KB page-load budget and the default 1,024 KB on-demand budget, so no
manifest has a `budget` field. The largest new file is under 1 MB, far below Cloudflare's 25 MiB.

### What browsers can do

Asked with WebCodecs `isConfigSupported` in Playwright 1.63.0 on Windows 10:

| | Chromium | Firefox | WebKit (Windows build) |
|---|---|---|---|
| Decode H.264, VP9, AAC, Opus | yes | yes | no WebCodecs at all |
| Encode H.264, VP9, Opus | yes | yes | no |
| Encode AAC | yes | **no** | no |
| `OffscreenCanvas` | yes | yes | no |

Not verified here: Safari on macOS and iOS, Chrome and Firefox on Android, and Playwright's WebKit
on Linux, which CI runs. So every tool asks the browser at run time and offers only what it says
it can do.

## Decision

1. **Exact versions:** `mediabunny` 1.61.0, `@mediabunny/flac-encoder` 1.61.0 and `gifenc` 1.0.3,
   in `tools/package.json`. They are used only from each tool's `worker.ts`, so nothing of them
   loads with the page.
2. **Support is asked, never assumed.** The worker reads the file's headers first, with Mediabunny.
   Then the page asks the browser, with WebCodecs `isConfigSupported`, whether it decodes that
   track and encodes each output, at the output size. It lists only what the browser can write,
   and says why the rest is missing. When nothing is possible, it says so in plain words.
   - Copying needs no codec: AAC into M4A, Opus into OGG, and the same codec into the same
     container. FLAC is libFLAC in WebAssembly, and WAV is plain PCM. So Video to audio and Audio
     converter make a real file even in a browser without WebCodecs.
   - The compressor copies the sound when the container takes it (AAC or Opus in MP4, Opus in
     WebM), encodes it again when the browser can, and otherwise leaves it out. The page says which
     before the visitor starts.
3. **No MP3,** neither written nor accepted as input by Audio converter.
4. **Limits**, each in the tool's `logic.ts`, unit tested at the edge and one over:
   - Video compressor: 500 MB, 10 minutes, at most 4K in, at most 1080p out, a target of at least
     0.5 MB.
   - Video to audio: 1 GB and 2 hours; WAV up to 30 minutes.
   - Audio converter: 300 MB and 2 hours; WAV and FLAC up to 30 minutes.
   - Video to GIF: 200 MB, a clip of 0.1 to 30 seconds, 16 to 480 pixels wide, 1 to 15 frames a
     second.
   - Every page says phones may fail before these limits, with no number.
5. **The target size is approximate.** The compressor works out a video bitrate from the target,
   the length and the sound, less 5% for the container. The page says that the file comes out near
   the target, not on it.
6. **GIF speed.** Frames are decoded once, in order, and each frame's palette is chosen from an even
   sample of at most 16,384 of its pixels. Choosing it from every pixel took about 215 ms a frame
   in the browser. The 450-frame GIF at the largest settings took 124 s in Chromium before and
   33 s after (66 s in Firefox), on the owner's machine.
7. **No CSP change.** Workers come from `'self'`. The FLAC encoder's blob worker is allowed by
   `worker-src 'self' blob:`. Its WebAssembly is allowed by `'wasm-unsafe-eval'`. GIF previews and
   downloads use `blob:` URLs, which `img-src` and `media-src` already allow. The E2E specs assert
   zero CSP violations.
8. **Fixtures** are our own, made with FFmpeg's test sources and permissive encoders only
   (`e2e/fixtures/README.md`). Large files are never made; size limits are unit tested only.
9. **Long cache for versioned vendor folders.**
   - `versionedVendorPaths` in `config/headers.ts` lists `/vendor/pdfjs/<version>/*` and
     `/vendor/libheif/<version>/*`, built from `PDFJS_BASE` and `LIBHEIF_BASE`. They join
     `immutablePaths`, so `dist/_headers` sends them `public, max-age=31536000, immutable`.
   - Each folder holds files copied unmodified from one package, and its name is that package's
     exact version. A new version is a new folder, so an old file can never be served for a new
     one.
   - **Tesseract is not included.** Its folder carries the tesseract.js version, but the language
     data in it comes from `@tesseract.js-data/eng` and `@tesseract.js-data/hin`. Those could
     change while the path stays the same, and a year-long cache would then serve stale data.
   - A unit test checks that each path names the version in the installed package's own
     `package.json` and that Tesseract stays out. `headers.spec.ts` checks the headers on
     `wrangler dev`, and `pnpm check:production` checks them on the live site.

## Consequences

- **What each browser runs locally** (Windows, Playwright 1.63.0):
  - Chromium runs every conversion for real.
  - Firefox runs everything except AAC encoding, where the page explains why.
  - The Windows WebKit build runs the copies, WAV and FLAC for real, and shows the honest message
    for everything that needs WebCodecs.
  - CI's Linux WebKit may support more, so the specs pick their path from what the browser says,
    not from its name.
- **Upgrades.** Mediabunny and its FLAC encoder must move together. A new FLAC encoder release
  needs its build flags checked again for Ogg or GPL parts. The About page's version and source
  link follow `tools/package.json`, and a test keeps them in step.
- **Vendor upgrades.** A PDF.js or libheif-js upgrade changes the folder name through the version
  constant, which a test keeps equal to the installed version, so the long cache stays safe.
  Changing a file inside a versioned folder without a version change would break this, which is
  why the folders hold unmodified package files only.
