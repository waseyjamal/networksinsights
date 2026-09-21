# 0041. Share images

Status: Accepted
Date: 2026-09-21

## Context

A link shared in Slack, X, LinkedIn or a chat shows a card, and the card is mostly its image. Open Graph consumers show 1200 by 630 (1.91:1) in full, and X shows the same size as a large card (X's documented limits: at least 300 by 157, at most 4096 by 4096, under 5 MB; it falls back to the Open Graph image). Every tool page, every category page and the home page needs one, and the site grows without limit, so the images have to be made by the build from the same data as the pages, in the Signal design, with no hand-made file and no per-tool work.

## Decision

**Takumi renders them.** `@takumi-rs/core` 2.14.0 (exact, a devDependency of `apps/web`; license `(MIT OR Apache-2.0)`) turns a tree of boxes and text into a PNG in native code, with no browser and no SVG step. It reads the same Geist variable woff2 file the pages load, so the type is identical, and it drew all weights correctly in the spike.

Dependency facts (AGENTS.md asks for them): it adds `@takumi-rs/core`, `@takumi-rs/helpers` (231 KB) and one platform binary of about 6.6 to 7 MB (the others are optional dependencies that are not installed). **Nothing is added to the shipped site**: it is a build-time tool, and its output is PNG files. It has no install script, so `allowBuilds` stays denied; 2.14.0 was published on 2026-09-15, older than the three-day `minimumReleaseAge`. The project releases often (11 releases in the four weeks before this decision), which is why the version is pinned exactly and why the image cache is keyed by its version.

**Alternatives.**
- Satori 0.33.4 with `@resvg/resvg-js` 2.6.2: mature, but two dependencies under **MPL-2.0** (weak copyleft, not on the banned list, but it would need the owner's approval), and Satori reads TTF, OTF and WOFF but not the woff2 files the site has, so a third font dependency would be needed.
- `sharp` (Apache-2.0), which is already installed through Astro: its SVG text uses the fonts installed on the machine, so a local build and a CI build would differ.
- Headless Chromium through Playwright: no new dependency, but every build job would need a browser and a thousand screenshots.

**The design** is the dark Signal theme: the background, text and brand colors are read from `tokens.css` through the same `parseTokens` the theme-color meta uses, so there is no raw color in the code. Each card has the constellation mark and the wordmark, a small category label on a tool card, the page's title (the same words as its H1, sized by length so a 60-character name still fits, which a test measures) and one line (the summary, or the category description). Every word is data the page already shows: no counts and no claims.

**Where they come from.** `pages/og/[...slug].png.ts` writes `/og/home.png`, `/og/<category-slug>.png` and `/og/<tool-id>.png` during `astro build`. `og` is a reserved path, so no tool can take it. The 404 page, the design system and the static pages use the home card. The alt text is the card's words.

**Build time.** Measured on a 4-core Windows 10 machine:
- One image takes about 80 ms to draw. Drawn one by one as the pages come up, 312 images (300 tools) took 51 s, so a thousand tools would cost about 160 s of a build.
- A background pool draws four at a time (Node gives native threads a pool of four), and the pages find their images ready: 300 images in 19 s, 64 ms each. A thousand would take about 64 s.
- **A cache** in `apps/web/node_modules/.cache/share-images` keeps each drawn PNG under a hash of everything that decides its pixels: the box-and-text tree, the font file and the renderer's version. A card that has not changed is read back: 300 images in 0.33 s. The key means a card is redrawn exactly when it would come out different, and a stale image cannot be served. Files are written under a temporary name and renamed, so a build that stops halfway leaves no partial image. The cache is used only in a build (`import.meta.env.PROD`); the dev server draws a card when it is asked for.
- The cache lives in `node_modules`, which CI does not keep, so a CI build pays the 64 s per thousand tools. Keeping the folder with `actions/cache` would remove that; it is not done yet because it needs a pinned action and there are no tools to draw.

**Size.** A card is about 100 KB (the glow is a gradient), so a thousand tools add about 100 MB to the deploy, well under Cloudflare's per-version file limits.

## Consequences

- A new tool or category gets its share image with no work, and `pnpm check:seo` fails a build in which a page names an image that does not exist, is not a PNG, or is not 1200 by 630.
- The renderer is young. If it breaks, the fallback is Satori with `@resvg/resvg-js` and an ADR for the MPL license.
- Images are drawn in the dark theme only, which is what social feeds use.

## Revisit when

A thousand tools make the CI image step matter (add `actions/cache`), the renderer is replaced, or the design system changes the brand marks.
