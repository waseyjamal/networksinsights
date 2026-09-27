# 0052. Installable app, offline service worker and Lighthouse budgets

Status: Accepted
Date: 2026-09-27

Implements [ADR 0022](0022-installable-pwa.md). Amends [ADR 0046](0046-intent-loaded-search.md) (the scripts every page carries): every page now also carries one deferred file that registers the service worker. The search loader, its 2 KB limit and "nothing of search before intent" are unchanged.

## Context

ADR 0022 promised an installable app that keeps working on a poor connection, and a Trusted Web Activity (a Play Store app) will need the same pieces later: HTTPS, a manifest and a service worker. Mission 17 also asked for site-wide performance budgets, enforced in CI, on a mobile profile.

Checked against the current documentation on 2026-09-27:

- **Chrome's install criteria** (web.dev, "What does it take to be installable?", last updated 2024-09-19): a manifest with `name` or `short_name`, 192 and 512 pixel icons, `start_url`, `display` of `fullscreen`, `standalone`, `minimal-ui` or `window-controls-overlay`, and `prefer_related_applications` absent or false; HTTPS; and some engagement (a click or tap, and 30 seconds on the page) before Chrome offers to install. A service worker is not among the criteria, but offline support needs one anyway.
- **Trusted Web Activity** (Chrome for Developers, "Quick start"): the site proves it owns the app with `/.well-known/assetlinks.json`, which names the app's package and the SHA-256 fingerprint of its signing key. Bubblewrap builds the app from the manifest.
- **Maskable icons** (W3C Web App Manifest, `purpose`): the part a launcher may keep is the circle of 40 percent radius in the middle.
- **Workbox** (MIT) is the usual library. Its build plugins precache from a glob of the build; they know nothing about which chunks an island imports on demand, so "a tool works offline after one visit" would still need our own chunk graph. What is left for it to do (cache names, routing, expiry) is about 200 lines.
- **Lighthouse CI** (`@lhci/cli`, Apache-2.0): last release 0.15.1 on 2025-06-25, which depends on Lighthouse 12. Lighthouse itself (Apache-2.0) is 13.5.0, released 2026-09-18.

## Decision

**Manifest and icons from the existing data.** `/manifest.webmanifest` is built from `config/site.ts` (name, `short_name` "NetworksInsights", description) and `tokens.css` (`theme_color` and `background_color` are the light theme's `--bg`, like the default `<meta name="theme-color">`). The icons are drawn at build time by Takumi, the share images' renderer (ADR 0041), from the wordmark's constellation mark: 192 and 512 `any` (a rounded square), 192 and 512 `maskable` (full bleed, the mark inside the safe zone), a 180 pixel `apple-touch-icon`, and `/favicon.svg` and `/favicon.ico` (16, 32 and 48 pixel PNGs in one ICO). They replace the Astro template's favicons, which were still in `public/`. `icons` is a reserved path.

**An in-house service worker, no library.** `apps/web/src/lib/pwa/service-worker.ts` is the whole worker. It imports nothing. After every build, an integration strips its types, adds the settings of that build and writes `dist/sw.js`, a classic script of about 2 KB gzip. The settings are read from the built files: the shell, and a graph of which built file loads which (static and dynamic imports, worker and `.wasm` URLs, fonts in CSS), with the same patterns as `pnpm check:budgets`.

- **Pages: network first.** A visitor online always gets the current page. Every page that answers 200 as HTML, without `no-store`, is kept on the device together with every file it needs, found through the graph, including the chunks a tool imports on demand and its Web Worker. That is what makes a browser-runtime tool work offline after one visit. The page a visitor is on when the worker first starts was loaded before the worker existed, so the worker fetches and keeps it on activation. With a kept copy at hand, a page waits at most 4 seconds for the network before the copy answers, and the network answer still refreshes the copy. A page never kept answers with the offline page.
- **Hashed files (`/_astro/*`): cache first.** Their names change with their content.
- **Never kept:** anything but GET, range requests, other origins (Umami's endpoint), `/api/` (the future server runtime, ADR 0050), `/sw.js` itself, errors, and any response with `no-store`. Search is fetched only after intent (ADR 0046): the graph has no edge into the search module, the shell leaves it out, and it is kept only after a visitor has opened search.
- **Limits.** At most 100 pages and 600 files are kept; the oldest written go first.
- **Updates.** Every build is a new `sw.js`: its version is a hash of every built file. It is registered with `updateViaCache: "none"`, and served with the revalidate-every-time default (never in `immutablePaths`), so the browser checks it on every navigation. A new worker keeps its shell in a new cache, takes over at once (`skipWaiting`, `clients.claim`) and deletes the old shell. Kept pages and files stay, so a tab still open on the previous build still finds its code. Because pages are network first, no page stays stale while the visitor is online.
- **Navigation preload** is on, so network first costs no extra wait for the worker to start.

**The shell** is the offline page, the home page, `/tools/`, the manifest, the icons, and every file those three pages need.

**Registration.** `components/layout/ServiceWorker.astro` registers `/sw.js` after the `load` event, in a production build only. It is one deferred module file on every page, at most 1 KB gzip (it is 0.2 KB). Like the analytics script, it is kept a file, never inlined (`assetsInlineLimit`). `pnpm check:budgets` and `budgets.spec.ts` check it on every page.

**The offline page** (`/offline/`, noindex, not in the sitemap) says only what is true: this page has not been saved on this device yet; pages opened while online are saved; tools that need the server still need a connection.

**Privacy.** The worker keeps copies of the site's own pages and code in the visitor's browser and sends nothing. The privacy page says so. It never keeps what a visitor types or the files they open.

**Lighthouse budgets.** `pnpm check:lighthouse` runs Lighthouse 13.5.0 (a root dev dependency, Apache-2.0, about 19 MB installed with its dependencies, dev only, nothing reaches a visitor) through its Node API. It uses the Chromium Playwright already installs, against `astro preview` over the build. The pages are the home page, `/tools/`, `/text-tools/` and every tool page. It uses Lighthouse's default mobile profile (simulated slow 4G, 4x CPU slowdown), three runs per page, and judges each metric on its median. A page fails over **LCP 2.5 s, CLS 0.1 or TBT 200 ms**, Google's "good" thresholds (TBT stands in for INP in a lab run). The CI job `lighthouse` runs it after `quality`, keeps the HTML and JSON reports as an artifact, and gates `preview` and `deploy`. `astro preview` sends files uncompressed where Cloudflare sends brotli, so the measured numbers are slightly worse than production's.

`@lhci/cli` was not taken: it pins an older Lighthouse and adds a server and a storage layer the project does not need.

**Trusted Web Activity.** Everything a TWA needs is in place except the Digital Asset Links file, which is added only when the app exists (`docs/runbooks/play-store-twa.md`).

## Consequences

- The site installs in Chrome on desktop and Android, and every tool that runs in the browser works offline once its page has been opened.
- Every page carries one more small script file. The rule of ADR 0046 becomes: the theme script inline, the search loader, the service worker registration, and in a build with analytics the two analytics files.
- `sw.js` grows with the chunk graph, about 60 bytes per built file that imports another. `pnpm check:budgets` fails it above 48 KB gzip, which is thousands of tools away.
- The E2E tests block service workers, because `page.route()` does not see requests a worker answers. Only `pwa.spec.ts` turns the worker on. Playwright can emulate offline for a worker in Chromium only, so the offline tests run in Chromium. Firefox and WebKit still register the worker and keep the shell. The update flow is tested with a fake cache store, because a browser test cannot serve a second build of `sw.js`.
- Lighthouse runs add about 10 seconds per page per run to CI. With three runs, 500 tool pages would take hours, so the page list or the run count will need to change as the catalog grows.
- A visitor who is offline sees a kept page as it was when it was kept; they get the newest one on the next visit online.

## Revisit when

- The server runtime ships (ADR 0050): check that its endpoints live under `/api/` or answer `no-store`.
- The catalog passes about 50 tools: measure a sample of tool pages per category instead of every one, or measure only the tools a pull request changes.
- The Play Store app is built: add `/.well-known/assetlinks.json` and `related_applications` (the runbook).
- Workbox or the platform gains a way to precache an island's on-demand chunks without our graph.
