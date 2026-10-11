# 0072. One app shell script on every page: the navigation bar and the install control

Status: Accepted
Date: 2026-10-11
Amends: [ADR 0046](0046-intent-loaded-search.md) and [ADR 0052](0052-pwa-service-worker-and-lighthouse-budgets.md), which list the scripts every page may carry

## Context

On a phone, taps felt dead. Links and cards had no pressed state, pages changed so quickly that nothing showed a navigation had happened, the installed app (which has no browser loading bar) gave no sign that a tap had done anything, and there was no way to install the site except the browser's own menu.

Press states and the cross-fade between pages are CSS. Two things are not: showing a bar the moment a link is tapped, and offering "Install app", which needs Chromium's `beforeinstallprompt` event or, elsewhere, steps that depend on the browser. Both need a script on every page. Until now every page carried exactly the inline theme script, the search loader (ADR 0046) and the service worker's registration (ADR 0052), plus two analytics files in production (ADR 0051), and `pnpm check:budgets` and `budgets.spec.ts` failed a page with any other script.

## Decision

- Every page carries one more deferred module, the app shell: `components/layout/AppShell.astro`, whose script is `lib/pwa/app-shell.ts`. It is at most **1 KB gzip** and **imports nothing**, statically or with `import()`. It is a file, never inlined (`assetsInlineLimit` in `astro.config.mjs`), so the CSP stays as strict as it is.
- `scripts/lib/app-shell.ts` (the "App shell" section of `pnpm check:budgets`) fails a build where a page has no app shell or two, loads it as a classic script, pages load different copies, the file is over 1 KB gzip, or it imports anything. `e2e/helpers.ts` checks the same in a browser. The search loader check accepts this one file by name, as it does the registration script. No existing limit changed.
- Navigation bar: a click on a link to another page of this site, in this tab, with no modifier key, sets `data-state="loading"` on a 3 px bar, which `components.css` shows at once and grows towards 90%. `pageshow` clears it, which also covers a page restored from the back/forward cache.
- Install control: one "Install app" button in the footer and one in the mobile menu, hidden in the HTML. The script decides, feature tests first and the user agent only where nothing else can tell:
  1. already installed (`display-mode: standalone`, `navigator.standalone`): stay hidden;
  2. a social app's built-in browser (user agent): a dialog that asks to open the page in Chrome or Safari;
  3. iPhone or iPad (user agent, and a touch screen for iPadOS): a dialog with "Share, then Add to Home Screen";
  4. `onbeforeinstallprompt` exists (Chromium on Android, Windows, macOS, Linux): shown only once the browser fires the event; a tap shows "Installing…" at once, then "Installed" on `appinstalled`; a dismissed prompt cannot be shown again, so the control hides until the browser offers a new one;
  5. `window.safari` exists (Safari on a Mac): a dialog with "File, then Add to Dock";
  6. Firefox (`mozInnerScreenX`) with a coarse pointer: a dialog with "menu, then Install or Add to Home screen";
  7. anything else, Firefox on a desktop included: stay hidden.
- The dialog is a native `<dialog>` opened with `showModal()`: the page behind is inert, so focus stays inside, and Esc closes it. Its markup is complete in the HTML; the script only names the platform, and CSS shows the matching steps. "Installing…" and "Installed" are announced through a polite live region.
- The script stores nothing and sends nothing.

## Consequences

- Every page downloads one more small file, cached across pages. Measured on the build of 2026-10-11: 942 B gzip.
- Safari on macOS before 17 has no Add to Dock; it gets the same steps, because no feature test can tell it apart.
- A new job for this script must fit in the same 1 KB, or come with a new ADR. Code that only some pages need belongs in an island, not here.
