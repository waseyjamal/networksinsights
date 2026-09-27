# Runbook: the installable app, offline support and the Play Store

Why and how it works: [ADR 0052](../adr/0052-pwa-service-worker-and-lighthouse-budgets.md). The site is an installable web app. A service worker keeps the pages a visitor opens, so browser tools work offline. `pnpm check:lighthouse` holds every key page to the performance budgets.

## Check that it installs

1. **Desktop Chrome:** open `https://networksinsights.com/`, click somewhere on the page and wait about 30 seconds (Chrome's engagement rule). The install icon appears at the right of the address bar. DevTools, **Application**, **Manifest** lists any installability problem.
2. **Android Chrome:** open the site, tap the page, then the menu (⋮) and **Install app** (older versions say **Add to Home screen**). The icon is the constellation mark on the dark background. Open it from the home screen: it runs without the address bar.
3. **iOS Safari:** Share, **Add to Home Screen**. Safari reads `apple-touch-icon`, not the manifest's icons.

A preview deployment installs too, but as a separate app: its origin is different.

## Check that a tool works offline

1. Open a tool page once while online, for example `/word-counter/`. Wait a few seconds: the worker keeps the page and its code in the background.
2. DevTools, **Application**, **Service workers**: `sw.js` is *activated and is running*. Under **Cache storage**, `ni-pages` lists the page, and `ni-files` lists its `/_astro/` files.
3. Tick **Offline** (Network tab) and reload. The tool loads and works. A page never opened shows "You are offline".

`pwa.spec.ts` does the same in CI, in Chromium.

## A new deploy

Nothing to do. Every build writes a new `sw.js`. Browsers check it on each visit and never take it from their HTTP cache (`updateViaCache: "none"`, and `sw.js` is not in `immutablePaths`). The new worker takes over at once and deletes the old shell. `pnpm check:production` fails if `/sw.js` or the manifest is ever served with a long cache.

**Emergency: turn the worker off everywhere.** If a broken worker ever ships, the fastest fix is a worker that removes itself. Replace the body of `start()` in `apps/web/src/lib/pwa/service-worker.ts` with code that, on `activate`, deletes every cache and calls `self.registration.unregister()`. Deploy it through CI as usual. Visitors pick it up on their next visit. Never make `/sw.js` answer 404 to do this: a failed update check keeps the old worker running.

## When `lighthouse` fails in CI

1. Download the `lighthouse-report` artifact of the run. It has one HTML report (open it in a browser) and one JSON file per page.
2. The job log's table names the page and the metric. The HTML report's **Diagnostics** show the cause: the LCP element, the long tasks behind TBT, the elements that shifted for CLS.
3. Reproduce locally: `pnpm build`, then `pnpm check:lighthouse --page /word-counter/ --out lighthouse-report`. In Git Bash, run it as `MSYS_NO_PATHCONV=1 pnpm check:lighthouse --page /` so the path is not rewritten to a Windows path. A busy laptop measures a higher TBT than CI does. Trust CI's numbers, and compare locally before and after a change rather than against the budget.

Never raise a budget to make a page pass. A budget changes only through an ADR that supersedes ADR 0052.

## The Play Store app (Trusted Web Activity), when the owner decides to build it

The site already has what a Trusted Web Activity needs: HTTPS, a manifest, a service worker with an offline page, and good Lighthouse scores. What is missing is the proof that the site and the app belong together. It is added only when the app exists.

1. Build the app with Bubblewrap, **outside this repository** (AGENTS.md: work only inside this repository, no global installs). In an empty folder: `pnpm dlx @bubblewrap/cli init --manifest=https://networksinsights.com/manifest.webmanifest`, then `pnpm dlx @bubblewrap/cli build`. Bubblewrap asks for the package name (for example `com.networksinsights.app`) and creates a signing key. Keep that key and its password out of any repository, in a password manager.
2. Upload the app to the Play Console with **Play App Signing** on. Google then signs the published app with its own key. Copy the **SHA-256 certificate fingerprint** of the *app signing key* (Play Console, **Test and release**, **App integrity**). The fingerprint of your upload key will not verify.
3. In a branch, add `apps/web/public/.well-known/assetlinks.json`:

   ```json
   [
     {
       "relation": ["delegate_permission/common.handle_all_urls"],
       "target": {
         "namespace": "android_app",
         "package_name": "com.networksinsights.app",
         "sha256_cert_fingerprints": ["AA:BB:…:FF"]
       }
     }
   ]
   ```

4. In the same branch, add `related_applications` to `webManifest()` in `apps/web/src/lib/pwa/manifest.ts` (`{ platform: "play", id: "<package name>" }`). Keep `prefer_related_applications: false`, so the browser still offers the web app. Record the decision in an ADR.
5. After the deploy, check `https://networksinsights.com/.well-known/assetlinks.json`. It must answer 200 with JSON and no redirect: it is a file, so the trailing-slash rule does not touch it. Then check it with Google's Statement List tester: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://networksinsights.com&relation=delegate_permission/common.handle_all_urls`.
6. Install the app from an internal test track. If it opens with an address bar, verification failed: the fingerprint is almost always the cause.
