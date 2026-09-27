# 0046. Intent-loaded search

Status: Accepted
Date: 2026-09-22

Amended by [ADR 0051](0051-analytics-and-error-reporting.md): a build with analytics carries two more deferred files, the analytics tracker and its events script; the loader and its 2 KB limit are unchanged.

Amended by [ADR 0052](0052-pwa-service-worker-and-lighthouse-budgets.md): every page also carries one deferred file that registers the service worker; the service worker never fetches search before intent.

Amends [ADR 0033](0033-registry-and-build-time-validation.md) (zero JavaScript on listing pages) and [ADR 0028](0028-design-system-signal.md) (the theme script is the only JavaScript every page ships).

## Context

Until Mission 11 the rule was absolute: a page that lists tools, and every other page that is not a tool, loads no script file and no framework. The only JavaScript on the home page was the 559-byte inline theme script (ADR 0028), and `zero-js.test.ts` and `budgets.spec.ts` failed the build if a page gained another.

Search needs JavaScript: an engine, an index and a dialog. It also has to open from anywhere (Ctrl+K, Cmd+K, "/") and feel instant. Two easy answers are both wrong. Loading the engine and the index on every page breaks the promise that a page which is only read costs only its HTML. Loading nothing until the visitor clicks makes the first search wait for a download after the click.

## Decision

**Load on intent.** No page loads the search engine, the index or any framework code until the visitor shows intent. Intent is any of: pointer hover, keyboard focus or a press on the command bar or on the `/tools/` filter box; or a shortcut key. Reading a page (moving the mouse, scrolling, typing letters) asks for nothing.

**One loader, on every page.** `SearchDialog.astro`, which `Base.astro` renders once for every page, carries one `<script>`. Astro bundles it as a deferred module file, `_astro/SearchDialog…js`. It is the only script file a page without an island loads, and it does one job: listen for intent and call `import()` on the search module. It contains:
- capture-phase listeners for `pointerover`, `focusin` and `pointerdown` that start the import;
- a `click` handler on the command bar link that opens the dialog, except for a click with a modifier key or a non-primary button, which keeps its meaning (Ctrl-click still opens a new tab);
- a `keydown` handler for the shortcuts (`intent.ts`, tested in Node): Ctrl+K and Cmd+K from anywhere, "/" only when the visitor is not typing in an input, textarea, select or editable text;
- one line that lets CSS show Cmd instead of Ctrl on Apple devices.

It has no static import of the engine or the UI. Its size limit is **2 KB gzip**. It is 1,329 B gzip today; 1.3 KB of its 2.6 KB raw is Vite's dynamic-import helper.

**What loads, and when.** The first intent imports `search-ui.<hash>.js` (4.6 KB gzip: the engine, the index reader and the dialog and filter code) and, from it, fetches the index (ADR 0045) once. Later intents reuse both. Hovering the command bar puts the module and the index in flight before the click lands, so the first keystroke after the dialog opens is answered at once.

**The link stays a link.** The command bar is `<a href="/tools/">`. Without JavaScript it goes to all tools, the dialog is a closed native `<dialog>` that is not in the accessibility tree, the Ctrl+K hint and the filter box are hidden by CSS (they appear only when the page has scripts), and nothing of search is requested. With JavaScript, if the module cannot be fetched (offline, blocked, a bad deploy), the click falls back to following the link. If the filter's module cannot load, the filter hides itself and the full list stays.

**The `/tools/` filter** is the same engine over the same index, as progressive enhancement: the full list is in the HTML, and the filter box is shown only when the page has scripts. It hides rows and empty category headings in place, keeps the order, and shows a live count.

**What changes in the rules.**
- ADR 0033's "Zero JavaScript on listing pages" becomes: no framework JavaScript, no island, and exactly one deferred script, this loader. `zero-js.test.ts` pins that the loader comes from `SearchDialog`, which only `Base.astro` renders.
- ADR 0028's theme-script rule stays for inline scripts: the theme script is still the only inline script. The loader is a file, not an inline script.
- The unit tests, `budgets.spec.ts` and `pnpm check:budgets` now say exactly: on a page with no island, the theme script, one loader of at most 2 KB gzip, nothing else; no `<link>` that preloads or prefetches the module or the index; the module reached only through `import()`. `pnpm check:budgets` checks it on the built output of every page.
- AGENTS.md: "JavaScript only inside islands" becomes "…plus the theme script and the search loader (ADR 0046)".

**For Mission 12 (CSP).** The loader and the search module are same-origin files, so `script-src 'self'` covers them and nothing needs a hash. The theme script is still inline and static, and still needs its hash. The index request needs `connect-src 'self'`.

**Measured**, at 1,000 synthetic tools, typing ten queries one letter at a time with real key events, on a Windows 10 machine. "In the page" is from the keydown event to the results being in the DOM; "painted" is to the next frame. The target is under 50 ms.

| Engine | In the page, median / p95 | Painted, median / p95 |
|---|---|---|
| Chromium | 2.5 / 3.8 ms | 10.5 / 19.4 ms |
| Firefox | 5.0 / 8.0 ms | 27 / 45 ms |
| WebKit (Playwright build, device scale factor 2) | 6.0 / 10 ms | 80 / 122 ms |

Two findings changed the design. A `backdrop-filter: blur()` over the whole viewport behind the dialog took about 50 ms a frame in a software-rendered Chromium, against about 10 without it, so the backdrop is a plain scrim. A large `box-shadow` on the panel, whose contents change on every keystroke, took a software-rendered WebKit from 14 ms to about 60 (at a device scale factor of 1); the panel has none, and the border and the scrim set the panel apart.

The WebKit painted figure is a property of the test rig, not of Safari: Playwright's "Desktop Safari" profile uses a device scale factor of 2 on a software renderer, which is four times the pixels. The same page in the same build at a device scale factor of 1 painted at a median of 16 ms and a p95 of 46 ms. That is why the Playwright test asserts the in-page time strictly in every engine (p95 under 50 ms), the painted time against 50 ms in Chromium and Firefox, and only loosely in WebKit.

## Consequences

- Good: a page that is only read still costs its HTML, its CSS and one 1.3 KB script that does nothing until the visitor moves toward search.
- Good: the first search is warm. Hover, focus and pointer-down all start the download, and each comes before the click completes.
- Cost: the "no script file on a listing page" rule no longer holds, and every page carries a request for the loader. It is a static, immutable-cached file (ADR 0045).
- Cost: a shortcut pressed on a page that has shown no earlier intent waits for the module before the dialog opens, the time it takes to fetch a 4.6 KB file. Keystrokes typed in that gap are not caught. The loader could open the dialog itself before the module arrives, but it would stop being only a loader; if the gap proves to matter it is the first thing to change.
- Cost: `<dialog>` with `showModal()` is native and needs no polyfill. Its Tab behaviour is the browser's: focus can move up into the browser's own toolbar, never onto the inert page behind.

## Revisit when

- The loader passes 2 KB gzip: move whatever was added into the search module.
- A second feature needs intent-loaded code: give the loader a small registry, do not add a second script.
- A tool page, which already loads an island, wants search inside the island: reuse the module through `import()`, do not bundle a second engine.
