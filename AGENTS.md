# AGENTS.md

Rulebook for every AI coding agent working in this repository. Read it fully before you plan anything.

## Project

NetworksInsights.com is a free online tools platform. It starts at 500+ tools and grows without limit. Every tool is a plugin that follows one contract: `docs/tool-contract.md`.

## Workflow

1. Plan first. Show the full plan and wait for the owner's approval before changing anything.
2. One mission = one branch, named `mission/NN-short-name`. One tool = one branch, named `tool/<tool-id>`.
3. Never commit to `main`. Never merge; the owner merges.
4. Work only inside this repository.
5. End every mission with the report format that the mission asks for.

## Hard rules

Dependencies:
- Exact versions only. No `^`, no `~`, no ranges.
- No alpha, beta, rc or canary versions.
- Never bypass `minimumReleaseAge`.
- Never approve dependency build scripts (`allowBuilds` stays denied by default).
- Before adding any dependency, state in the plan why it is needed, its size impact and its license.

UI:
- UI must use design tokens and existing components; new components go into the design system first.

Content:
- Never invent content: no fake counts, ratings, testimonials or claims.

Tools:
- One tool is one folder: `tools/<category-id>/<tool-id>/`. The folder name is the tool id and the
  URL; the parent folder name is the category id. The full contract is `docs/tool-contract.md`.
- Required files: `tool.config.ts`, `logic.ts`, `ui.tsx`, `island.astro`, `content/en.mdx`,
  `logic.test.ts`. `worker.ts` is optional.
- Never write a tool folder by hand. Create it with `pnpm new:tool` (flags, no prompts) and follow
  `docs/adding-a-tool.md`. Remove every `TODO(new-tool)` marker before the tool is done.
- `ui.tsx` imports design-system components as `@ui`, and loads heavy code with a dynamic
  `import()` so the initial JavaScript stays under 40 KB gzip (ADR 0037).
- `island.astro` is fixed, byte for byte (`ISLAND_SOURCE` in the SDK). Never edit it per tool.
- `logic.ts` is pure: no DOM, no Node globals, no network, no React or Astro, and no top-level
  statements. It may import only `zod`, `@networksinsights/tool-sdk` and files in its own folder.
  Adding any other library to that allowlist takes an ADR stating license, size and why.
- The privacy statement on a tool page is derived from `runtime`. Never write it by hand.
- `content/en.mdx` is an intro paragraph, then H2 "How to use", "Examples", "Limits", "FAQ", in
  that order, with no H1. The first sentence of the intro is at most 30 words (ADR 0044). The FAQ is `###` questions ending in `?`. Minimum prose words: intro 40,
  How to use 50, Examples 40, Limits 30, FAQ 60 (two pairs). No placeholder text, no copied page
  (ADR 0036). A tool is not done until `pnpm check:tools --tool <id>` passes.
- PDF tools use `pdf-lib` 1.17.1 and `pdfjs-dist` only from `worker.ts`, never from `ui.tsx` or
  `logic.ts` (ADR 0057). A dynamic `import()` in a `ui.tsx` makes Vite share its preload helper with
  the search loader, which `pnpm check:budgets` then fails. PDF.js data files come from `/vendor/pdfjs/<version>/`;
  every library a tool ships is credited in `apps/web/src/config/credits.ts`.
- HEIC to JPG decodes with `libheif-js` 1.23.2, the only LGPL package allowed (ADR 0060): its wasm is
  served unmodified from `/vendor/libheif/<version>/`. OCR uses `tesseract.js` 7.0.0 from its worker,
  with its worker, core and language data served from `/vendor/tesseract/<version>/`, never a CDN.
- Video and audio tools use `mediabunny` 1.61.0 (MPL-2.0), `@mediabunny/flac-encoder` 1.61.0 (libFLAC,
  BSD-3-Clause, built without Ogg) and `gifenc` 1.0.3 (MIT), only from `worker.ts` (ADR 0061). Nothing GPL.
  A tool asks the browser with WebCodecs `isConfigSupported` what it can decode and encode, offers only
  that, and says plainly what it cannot do.
- MP3 is encoded only by LAME 3.100 in `wasm-media-encoders` 0.7.0, the one LGPL exception for an encoder
  (ADR 0064): load it with `createEncoder("audio/mpeg", "/vendor/wasm-media-encoders/0.7.0/mp3.wasm")` from
  `worker.ts`, never `createMp3Encoder` (it inlines a second copy). `pnpm check:budgets` fails unless the
  build holds exactly one LAME copy, the vendored `mp3.wasm`. No other MP3 encoder and no other LGPL package.
- ZIP files use `fflate` 0.8.3 (MIT) only from `worker.ts` (ADR 0064). Read a ZIP's central directory in
  `logic.ts` and refuse encrypted, ZIP64 and oversized archives before unpacking anything.
- Formatter libraries (`yaml` 2.9.1, `xml-formatter` 3.7.0, `sql-formatter` 15.9.0) load only from a
  tool's `worker.ts`; `logic.ts` takes the library as a parameter and imports nothing (ADR 0062).
  Compress PDF uses `@embedpdf/pdfium` 2.15.1 only from `worker.ts`; its wasm is the hashed file Vite
  emits. FreeType inside it is used under the FTL, never the GPLv2, with its notice in `credits.ts`.
- AI models run with `onnxruntime-web` 1.30.0 (MIT), plain wasm backend on one thread, only from a tool's
  `worker.ts`, importing `onnxruntime-web/wasm` (ADR 0066). Its wasm is served unmodified from
  `/vendor/onnxruntime-web/<version>/`; `pnpm check:budgets` fails if any other page can load it. Each model is
  `models/<id>/model.onnx` with its licence, listed in `apps/web/src/config/models.ts` with its SHA-256, served
  at `/models/<id>/<hash prefix>/` and checked by hash in the worker. Never transformers.js; a model over
  25 MiB, R2 or a CSP change needs its own ADR.
- Speech to Text runs Whisper tiny (Xenova/whisper-tiny 5332fcc3, Apache-2.0), English only, at most 3 minutes
  (ADR 0068). Its decoder is over 25 MiB, so it is served as two byte-exact parts, each at the start of its own
  hash; the worker checks every part and the joined decoder before use, and keeps nothing on a mismatch. No file
  in the build may pass 25 MiB: `pnpm check:budgets` fails on one. No R2, no Hindi, no BiRefNet (ADR 0068).
- EXIF Viewer & Remover reads tags with `exifr` 7.1.3 (MIT, lite build) and Image to SVG traces with
  `imagetracerjs` 1.2.6 (Unlicense), each only by a dynamic `import()` in its `worker.ts` (ADR 0069). A JPEG is
  cleaned without re-encoding and keeps only its orientation tag; an SVG is written by `toSvg` and must pass
  `isSafeSvg` (only `<svg>` and filled `<path>`s), never the library's own SVG string.
- `/vendor/<name>/<version>/*` is cached for a year only when the folder holds unmodified files of the one
  package whose exact version it names (`versionedVendorPaths`, ADR 0061). Tesseract's folder is not.
- A raised JavaScript budget goes in the manifest's `budget` field with a reason; never in the page.
- Files go to the visitor only through `saveFile` from `@ui`. Visitor text is rendered as text
  (`{value}`, `setText`), and a visitor's URL becomes a link only through `safeUrl`. Never
  `innerHTML`, `dangerouslySetInnerHTML`, `eval` or any other HTML or code sink: the
  `safe-rendering` gate fails on them (ADR 0050).
- A tool that needs more than the site-wide security headers sets `security` in its manifest,
  naming an ADR the owner accepted (ADR 0047). Never widen the site-wide policy for one tool.
- A `server` runtime tool follows the server contract of ADR 0050: validate with the manifest
  schema, size limits, per-IP rate limit, daily spending cap, no body logging, no stored user data.
- Never add a tool to make a page look fuller. The first real tool, `word-counter`, shipped in Mission 13.

Security (ADR 0047 to 0050, `docs/runbooks/security.md`):
- Every response header comes from `apps/web/src/config/headers.ts`; the build writes
  `dist/_headers` from it. Never write a header, a `_headers` file or a CSP `<meta>` by hand.
- The CSP allows no `'unsafe-inline'` or `'unsafe-eval'` for scripts, ever. A new inline script is a
  last resort: a constant string whose hash goes in `astro.config.mjs`; the build fails without it.
- `zod` in the web app is the jitless wrapper `src/lib/zod-jitless.ts`; do not import Zod around it.
- Preview deployments send `X-Robots-Tag: noindex`; production must never send it.
- `pnpm audit --audit-level moderate` and `pnpm check:licenses` must pass. A licence outside the
  allowed set, or an ignored advisory, needs an owner-approved ADR.

Safety:
- Never commit secrets or `.env` files.
- No global installs and no global config changes.
- Never deploy from a local machine; deploys happen only through CI.

## License rule

No AGPL, GPL, SSPL or non-commercial licenses, for code, fonts or AI models, without an owner-approved ADR.

## Architecture principles

- Static HTML first. JavaScript only inside islands, plus three scripts every page carries: the inline theme script, the deferred search loader (ADR 0046) and the deferred service worker registration (ADR 0052). Nothing of search loads until a visitor shows intent. A production build with analytics adds exactly two more deferred files (ADR 0051).
- Tool logic is pure TypeScript with no UI or framework imports.
- Three runtimes: browser, worker, server.
- Process user files on the device whenever possible.
- Every page must be complete HTML without JavaScript, so crawlers can read it.

## Commands

Run from the repo root:

- `pnpm dev` — start the dev server
- `pnpm build` — production build
- `pnpm preview` — preview the production build
- `pnpm lint` — Biome check, no writes
- `pnpm fix` — Biome check with safe fixes written
- `pnpm typecheck` — type check the web app (`astro check`)
- `pnpm test` — run Vitest, without the tests tagged `slow` (fails if no tests are found). This is the fast tier that `pnpm check` and the pre-push hook run
- `pnpm test:slow` — run only the tests tagged `slow` (`it("…", { tags: ["slow"] }, …)`): benchmarks, the generated-tree typecheck, tests that spawn a CLI or a build. Rule of thumb: a test over about two seconds, or that spawns a process, is slow. CI's `quality` job runs it (ADR 0043)
- `pnpm test:e2e` — build, then run the Playwright E2E tests on chromium, firefox and webkit against `astro preview`, and the header and CSP tests against `wrangler dev` over the same build (it applies `dist/_headers` as Cloudflare does; local only, deploys nothing). Not part of `pnpm check` or the pre-push hook because it is slow; it runs in CI and on demand. It works when a coding agent runs it: the config sets `ASTRO_PREVIEW_BACKGROUND` so Astro keeps the server in the foreground (ADR 0043). First run needs `pnpm --filter web exec playwright install` (browsers go to Playwright's cache outside the repo).
- `pnpm check` — typecheck (SDK, scripts, tools, web, in parallel), then lint, then test (fast tier), then `check:tools`;
  stops at the first failure. About two minutes
- `pnpm new:tool` — create a tool folder (interactive, or with flags for an agent; see
  `docs/adding-a-tool.md`)
- `pnpm check:tools` — every tool gate on its own with a readable summary; `--tool <id>` checks one
  tool, `--json` prints JSON. Part of `pnpm check`
- `pnpm check:budgets` — the JavaScript budget of every tool page, the size and behaviour of the
  search loader every page carries, the analytics files when the build has them, and the installable
  app (service worker, its registration script, manifest, icons), and that no file is over 25 MiB (ADR 0068),
  from the build output; run after
  `pnpm build`. Runs in CI after the build (ADR 0037, ADR 0046, ADR 0051, ADR 0052)
- `pnpm check:lighthouse` — Lighthouse on its mobile profile against the build (`astro preview`):
  the home page, `/tools/`, one category page and every tool page, median of 3 runs, failing over
  LCP 2.5 s, CLS 0.1 or TBT 200 ms. `--page <path>`, `--runs <n>`, `--out <folder>` for reports.
  `--shard <i>/<n>` for one shard. Run after `pnpm build`; needs Playwright's Chromium. CI runs it in
  6 shards behind the `lighthouse` gate (ADR 0052, ADR 0063)
- `pnpm check:seo` — canonical links, Open Graph and Twitter/X tags, share images, structured data,
  robots.txt, sitemaps and llms.txt, from the build output; run after `pnpm build`. Runs in CI after
  the build (ADR 0038 to 0041)
- `pnpm check:production` — requests the live site: `/tools` must answer a permanent redirect, files
  must not redirect, `robots.txt` must match the launch flag, every security header and the CSP must
  be exactly as `config/headers.ts` says, with no `X-Robots-Tag`, pages must revalidate and hashed
  files (and the search index) must be cached for a year. Runs in CI after every production deploy
  (`verify-production`); it fails until the Cloudflare redirect rule exists
  (`docs/runbooks/seo-redirects.md`). `--preview --url <preview>` checks a preview instead: the same
  headers plus `X-Robots-Tag: noindex`, no redirect; the `preview` job runs it on every pull request
- `pnpm check:licenses` — every installed package, transitive and dev included, is under an allowed
  licence (ADR 0017, ADR 0049). CI's `supply-chain` job runs it with `pnpm audit --audit-level moderate`
- `node scripts/lockfile-diff.ts --base <old> --head <new>` — what a lockfile change adds, removes
  and updates, as Markdown; CI's `lockfile` job posts it on every pull request that changes the
  lockfile
- `pnpm indexnow` — `snapshot` and `submit`, run by CI around a production deploy to tell search
  engines which URLs changed. Never run it by hand against production (ADR 0042)

Git hooks (husky, see ADR 0024): pre-commit runs Biome on staged files; pre-push runs `pnpm check`.

CI (see ADR 0025): `.github/workflows/ci.yml` runs job `quality` (`pnpm check`, `pnpm test:slow`, `pnpm build`, `pnpm check:budgets`, `pnpm check:seo`), job `e2e` (`pnpm test:e2e`) job `supply-chain` (`pnpm audit --audit-level moderate`, `pnpm audit signatures`, `pnpm check:licenses`) and job `lighthouse` (the gate over `lighthouse-1` to `lighthouse-6`, each `pnpm build`, `pnpm check:lighthouse --shard <n>/6`, reports kept as an artifact per shard, ADR 0063) on every pull request to `main` and every push to `main`, and job `lockfile` on pull requests. `.github/workflows/supply-chain.yml` runs the supply-chain checks on `main` every Monday. Dependabot opens grouped weekly updates with a three-day cooldown (ADR 0049). Actions are pinned to full commit SHAs.

Tool gates (ADR 0035 to 0037, ADR 0047, ADR 0050): `pnpm build`, `pnpm check:tools` and CI fail on
contract, purity and content quality problems; `pnpm check:tools` and CI also fail on unsafe rendering
and on a security override without an accepted ADR. In `pnpm dev` the content quality problems only warn, so a tool that is
being written keeps rendering; contract violations stay hard. `quality` runs `pnpm check:budgets`
right after `pnpm build`.

Deploy (see ADR 0027): after `quality`, `e2e`, `supply-chain` and `lighthouse` pass, `ci.yml` job `preview` uploads a per-PR preview version and checks its headers, and job `deploy` deploys production on push to `main` (with the IndexNow steps around it) and job `verify-production` then checks the live site. `.github/workflows/rollback.yml` is a manual rollback, from `main` only. Wrangler is pinned in `apps/web`; it deploys only from CI, and runs locally only as `wrangler dev`, the E2E edge server, which touches no account. Runbook: `docs/runbooks/deploy-and-rollback.md`.

CI scope (ADR 0054, ADR 0055, ADR 0058, ADR 0063): the `scope` job (`scripts/ci-scope.ts`) cuts billed minutes without removing a test or a browser. A pull request or a push to `main` that changes only tool folders (plus each tool's own E2E spec) runs only those tools' specs plus every shared spec, in all three browsers; on a pull request Lighthouse then measures only those pages in one job, and every push to `main`, every other pull request, a manual run and a failed `scope` measure every page in 6 shards (when a measured shard passes 12 minutes, add a shard in a new ADR); any other change, any unknown file and any error runs the full suite. E2E runs per browser behind one `e2e` gate: 3 Playwright shards per browser on a full run (9 jobs), 1 job per browser on a scoped run; when any measured E2E job passes 25 minutes, add a shard in a new ADR. The gate needs every job that ran and uploads an `e2e-passed-full-<tree hash>` or `e2e-passed-scoped-<tree hash>` artifact. On `main`, a full run is skipped only for a "full" artifact of the same tree, and a scoped run for a "scoped" or a "full" one; `deploy` accepts a skipped `e2e` only when `scope` succeeded and decided the skip, and `verify-production` runs after every successful deploy. `workflow_dispatch` runs the full suite by hand (`docs/runbooks/ci.md`). Never write the skip decision by hand in a workflow.

## Search and AI answers (SEO/GEO/AEO)

- Every page's canonical URL, share tags and JSON-LD come from `apps/web/src/lib/seo/`. Never write a canonical link, an Open Graph tag or a JSON-LD block by hand in a page.
- Structured data must say only what the page shows. Never add `aggregateRating`, `review` or any rating: the site has none.
- `apps/web/src/config/crawlers.ts` is the one list of crawlers behind robots.txt. `trainingPolicy` is the owner's decision (ADR 0040).
- A tool page's Quick facts come from the manifest only (ADR 0044). The first sentence of a tool's intro answers first: at most 30 words, and it should name the tool.

## Search (ADR 0045, ADR 0046)

- The search index is generated from the registry at build time (`apps/web/src/lib/search/`) and served as `/search-index.<hash>.json`. Only tools whose status is not `deprecated` are in it. Never edit it by hand and never link, preload or prefetch it.
- The engine (`engine.ts`) is pure TypeScript with no dependency. Adding a search library needs an ADR that replaces ADR 0045.
- Every page carries one search loader script, at most 2 KB gzip, whose only job is to listen for intent and `import()` the search module. Do not add code to it, and never import the engine or the index statically from a page, a layout or the loader. `pnpm check:budgets` and `budgets.spec.ts` fail if a page loads any other script (besides the service worker registration and the analytics files) or fetches search before intent.
- Words from tools and from visitors reach the page as text nodes only. `innerHTML`, `insertAdjacentHTML`, `DOMParser` and `eval` are forbidden in `apps/web/src/lib/search/`; a test fails if one appears.
- Search stores nothing and sends nothing: no recent searches, no query logging. Adding either needs an ADR and a line in the privacy page.
- Synthetic tools (`synthetic.ts`, `corpus.ts`) exist for tests only. No page or build imports them.

## Analytics and error reports (ADR 0051)

- Umami Cloud, cookie-free. It is on only when the build has `UMAMI_WEBSITE_ID`, a repository variable that only the production deploy passes (`docs/runbooks/analytics.md`). Without it no page carries analytics.
- The tracker is `apps/web/src/lib/analytics/umami-tracker.js`, Umami's own file served from our origin. Never edit it, never reformat it, never load it from Umami's host. Update it only through `VENDOR.md` next to it; tests pin its hash.
- A page with analytics carries exactly two more deferred files: the tracker (at most 3 KB gzip) and `components/layout/Analytics.astro`'s script (at most 1 KB gzip). `pnpm check:budgets` and `budgets.spec.ts` enforce it.
- Events are only `tool-used` (`{ tool }`, once per page view) and `js-error` (scrubbed by `lib/analytics/events.ts`). Never send what a visitor typed, dropped or chose, a URL query, or anything that identifies a person. A new event, or a new field, needs an ADR and a line in the privacy page.
- The privacy page reads the same settings: never describe analytics there by hand.
- `connect-src` names `https://gateway.umami.is` and no other third party; `script-src` stays `'self'`.

## Installable app and offline (ADR 0052)

- The manifest (`/manifest.webmanifest`), the app icons (`/icons/*.png`) and the favicons are generated from `config/site.ts`, `tokens.css` and the constellation mark (`lib/pwa/`). Never add an icon or a manifest by hand, and never put a favicon in `public/`.
- The service worker is `apps/web/src/lib/pwa/service-worker.ts`, written in-house. It imports nothing; the build turns it into `dist/sw.js` with that build's settings. Never write `sw.js` by hand and never add a service worker library without an ADR.
- Pages are network first, `/_astro/*` cache first. It never keeps non-GET, other origins, `/api/`, `no-store` answers, or search before intent. A server-runtime endpoint lives under `/api/` or answers `Cache-Control: no-store`.
- `/sw.js` and the manifest must never be in `immutablePaths`; `pnpm check:production` fails if they are cached for long.
- E2E tests block service workers (`playwright.config.ts`); only `pwa.spec.ts` turns them on.
- The Play Store app (Trusted Web Activity) and `/.well-known/assetlinks.json` are added only when the app exists: `docs/runbooks/pwa-and-play-store.md`.

## Docs map

- `docs/architecture.md` — goals, layout, runtimes, quality targets, mission table
- `docs/tool-contract.md` — the contract every tool follows
- `docs/adding-a-tool.md` — how to add a tool, with the prompt template for an AI agent
- `docs/design-system.md` — the Signal design system: how to use tokens and components
- `docs/adr/` — one file per architecture decision
- `docs/launch-checklist.md` — every owner input and step needed before launch
- `docs/runbooks/` — step-by-step procedures (deploy and rollback, the redirect rule, IndexNow, security, analytics, the installable app and the Play Store)

## Changing a decision

A decision changes only through a new ADR that supersedes the old one. Update this file in the same branch.

## Windows note

The owner's machine is Windows 10. Shell commands run in Git Bash. Git Bash rewrites an argument that starts with `/` into a Windows path: run commands that take a URL path, such as `pnpm check:lighthouse --page /`, with `MSYS_NO_PATHCONV=1`.
