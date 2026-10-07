# 0069. exifr for EXIF Viewer & Remover, imagetracerjs for Image to SVG

Status: Accepted
Date: 2026-10-07

## Context

Tools batch 9B adds two image tools that work on the visitor's device:

- `exif-viewer-remover` shows the camera, date, software, orientation and GPS tags of a photo and
  saves a copy without its metadata.
- `image-to-svg` traces a JPG, PNG or WebP picture into an SVG of filled paths.

Facts were checked on 2026-10-07 on the npm registry, each project's GitHub repository (its
`LICENSE` file) and the installed packages. Sizes are esbuild minified bundles of what the worker
imports, gzip -9.

| Package | Version | Released | Licence (repository `LICENSE`) | Dependencies | Worker import, gzip |
|---|---|---|---|---|---|
| `exifr` (`dist/lite.esm.mjs`) | 7.1.3 | 2021-08-05 | MIT | none | 14.8 KB |
| `imagetracerjs` | 1.2.6 | 2020-05-18 | Unlicense (public domain dedication) | none | 5.8 KB |

Both are the latest release of their package. Both licences allow commercial use; MIT and Unlicense
are in the allowed set, and `pnpm check:licenses` passes. Neither has a build script. `pnpm audit
--audit-level moderate` reports nothing new. Neither has had a release for years; both are small,
self-contained parsers or algorithms with no network or DOM code on the paths the tools call, so
age alone is not a reason to refuse them. A security advisory would be, and Dependabot reports one.

## Decision

### Both libraries load only in their tool's worker

Each tool has `runtime: "worker"`. `worker.ts` imports the library with a dynamic `import()` on the
first job, so it is fetched only on that tool's page, after the visitor gives it a file (ADR 0057).
`logic.ts` imports neither: it holds the JPEG segment reader and rewriter, the SVG writer and the
SVG safety check, all pure and tested. No other page's JavaScript changes, and no budget is raised.

`apps/web` has `exifr` 7.1.3 as a dev dependency, so the E2E spec reads the downloaded copies with
the full exifr build in Node (GPS, XMP and IPTC included). It never reaches a page.

### No eval, no new Function, no CSP change

Neither library calls `eval`, `new Function` or `Function()` (searched in the shipped files). The
full exifr build has one `import()` of a Node module name, reached only when it runs under Node;
the tool imports the lite build, which has none. imagetracerjs's `appendSVGString` and `loadImage`
touch the DOM and the network, but the worker calls only `imagedataToTracedata`, which is pure
computation on an array of pixels. The site-wide CSP is unchanged and neither tool sets `security`.

### EXIF Viewer & Remover: what is done per format

- **JPEG**: `stripJpeg` drops the EXIF, XMP, IPTC, comment and other application segments before
  and between the scans, and anything after the end-of-image marker. The frame, tables and entropy
  coded data are copied byte for byte, so the decoded pixels are identical. JFIF, Adobe (APP14) and
  the ICC profile are kept: they tell the decoder how to read the colours.
- **Orientation**: when the EXIF orientation is 2 to 8, the copy gets a new EXIF segment holding
  only that tag, so the picture is shown the same way. When it is 1 or missing, the copy has no
  EXIF at all. The E2E test checks both cases, and that the decoded pixels and their dimensions are
  the same as the original's.
- **PNG and WebP**: the page draws the picture on a canvas and saves a new PNG. Every metadata
  chunk of the original is gone and the picture is re-encoded. WebKit's encoder writes its own sRGB
  ICC profile into the new PNG (seen in the E2E run); the page says some browsers add one. The tags inside a PNG or WebP are not read; the page
  lists the metadata blocks by name and warns when there is an EXIF or XMP block.
- No map and no request: a location is shown as numbers, with a warning.

### Image to SVG: the SVG is written by the tool, not by the library

The worker asks imagetracerjs only for its traced outlines (`imagedataToTracedata`) and `toSvg` in
`logic.ts` writes the SVG text from their numbers and palette colours. `isSafeSvg` then checks the
whole text: one `svg` element of self-closing `path` elements, each attribute from a short list
(`xmlns`, `width`, `height`, `viewBox`, `fill`, `fill-opacity`, `d`) with a value of digits, `rgb()` or path commands. Scripts, styles, links,
event handlers, `url()`, comments, doctypes and entities cannot pass. The worker refuses any SVG
that fails it, and the preview shows the SVG through an `<img>`.

The page decodes and scales the picture on a canvas, because Playwright's WebKit on Windows has no
`OffscreenCanvas` in workers. Pictures above 2,000,000 pixels are scaled down to about that size
before tracing, and the page says to what size. Colour sampling is deterministic, so the same
picture and preset give the same SVG.

### The E2E limits of the trace, set before the first run

A 200 × 200 white PNG with a red square from 50 to 150, traced with 2 colours and drawn back at
200 × 200: some path fill has red at least 240 and green and blue at most 15; the mean absolute
difference over all pixels and channels is at most 4 levels; at least 99% of pixels have every
channel within 48 levels; the centre is within 16 levels of pure red and the corner within 16 of
white. These limits are never raised after a failure.

The first run failed in Firefox: 98.99% of pixels within 48 levels (Chromium and WebKit 99.00%).
The tool then drew every path with a 1-pixel stroke of its own colour, which spread each colour half
a pixel over its neighbour. The stroke was removed from `toSvg`; the limits were not changed.

## Consequences

- Two more libraries are credited in `apps/web/src/config/credits.ts` and `credits.test.ts` checks
  their versions against `tools/package.json`.
- The pages make no quality claims beyond what the tests show: the JPEG copy's pixels are
  identical, and the trace of flat colour shapes matches within the limits above.
