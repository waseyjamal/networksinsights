import { expect, type Page, test } from "@playwright/test";
import { edgeURL } from "./edge";
import { makeTestPng } from "./support/test-image";

// The installable app (ADR 0052), against `wrangler dev` so the worker runs under the real headers
// and Content-Security-Policy (e2e/edge.ts). Every other spec blocks service workers; this one
// turns them on. Each test starts in a new browser context, so no worker or cache is left over.

test.use({ baseURL: edgeURL, serviceWorkers: "allow" });

/** Waits until a worker controls the page and has kept every open page (it does on activate). */
async function waitForWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }),
      );
    }
  });
}

/** Waits until the page and every file it names are kept on the device. */
async function waitUntilKept(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const path = location.pathname;
          if (!(await caches.match(path))) return `page ${path} not kept`;
          const files = [...document.querySelectorAll("script[src], link[href], astro-island")]
            .flatMap((el) => [
              el.getAttribute("src"),
              el.getAttribute("href"),
              el.getAttribute("component-url"),
              el.getAttribute("renderer-url"),
            ])
            .filter((url): url is string => url?.startsWith("/_astro/") ?? false);
          for (const url of files) {
            if (!(await caches.match(url))) return `file ${url} not kept`;
          }
          return "kept";
        }),
      { timeout: 15_000 },
    )
    .toBe("kept");
}

test.describe("manifest and icons", () => {
  test("every page links a manifest Chrome can install from", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/manifest+json");
    const manifest = await response.json();
    expect(manifest).toMatchObject({
      name: "NetworksInsights",
      short_name: "NetworksInsights",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    for (const icon of manifest.icons as Array<{ src: string; type: string }>) {
      const file = await request.get(icon.src);
      expect(file.status(), icon.src).toBe(200);
      expect(file.headers()["content-type"]).toBe(icon.type);
    }
    for (const path of ["/favicon.ico", "/favicon.svg", "/icons/apple-touch-icon.png"]) {
      expect((await request.get(path)).status(), path).toBe(200);
    }
  });

  test("Chrome reports no installability error", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "the installability report is a Chrome DevTools API");
    await page.goto("/");
    await waitForWorker(page);
    const session = await page.context().newCDPSession(page);
    const { installabilityErrors } = (await session.send("Page.getInstallabilityErrors")) as {
      installabilityErrors: Array<{ errorId: string }>;
    };
    expect(installabilityErrors.map((error) => error.errorId)).toEqual([]);
  });
});

test.describe("offline", () => {
  // Playwright's offline switch reaches the service worker only in Chromium: in Firefox the
  // worker's own requests still went out (the "offline" page loaded from the network on
  // 2026-09-27), and WebKit fails the navigation with an internal error. So the offline behavior
  // is tested in Chromium; the other two engines still register the worker and keep the shell.
  test.skip(({ browserName }) => browserName !== "chromium", "offline emulation is Chromium only");

  test("the word counter works offline after one visit", async ({ page, context }) => {
    await page.goto("/word-counter/");
    await waitForWorker(page);
    await waitUntilKept(page);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("astro-island:not([ssr])")).toHaveCount(1);
    await page.getByRole("textbox", { name: "Your text" }).fill("Offline words still count.");
    await expect(page.locator('[data-stat="words"] dd')).toHaveText("4");
  });

  test("the image compressor works offline after one visit, worker included", async ({
    page,
    context,
    browserName,
  }) => {
    await page.goto("/compress-image/");
    await waitForWorker(page);
    await waitUntilKept(page);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("astro-island:not([ssr])")).toHaveCount(1);
    await page.locator("#compress-image-files").setInputFiles(await makeTestPng(page));
    const row = page.locator(".ni-fileresult").first();
    await expect(row).toHaveAttribute("data-state", "done", { timeout: 30_000 });
    await expect(row.getByText(/% smaller$/)).toBeVisible();
    console.log(`compress-image offline (${browserName}): compressed in the worker`);
  });

  test("a page never opened shows the offline page, and the kept pages still open", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await waitForWorker(page);
    await waitUntilKept(page);

    await context.setOffline(true);
    await page.goto("/about/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You are offline");
    // The home page and /tools/ are kept at install.
    await page.goto("/tools/");
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("You are offline");
  });
});

test.describe("registration", () => {
  test("keeps nothing from another origin, nothing of search before intent, and no API answer", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForWorker(page);
    await waitUntilKept(page);
    const kept = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
      }
      return urls;
    });
    for (const url of kept) {
      expect(new URL(url).origin, url).toBe(new URL(page.url()).origin);
      expect(url).not.toMatch(/search-ui\.|search-index\./);
      expect(url).not.toMatch(/\/api\//);
    }
  });
  // The update flow itself (a new build installs, takes over, drops the old shell and keeps kept
  // pages) is tested with a fake cache store in lib/pwa/service-worker.test.ts: a browser test
  // cannot serve a second build of sw.js, because the worker's own update request is not routable.
  test("registers for the whole site, never from the HTTP cache, and keeps one shell", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForWorker(page);
    await expect
      .poll(
        () =>
          page.evaluate(
            async () => (await navigator.serviceWorker.getRegistration())?.active?.state,
          ),
        // Activation keeps the open page and its files first; under three engines at once that
        // can take a few seconds.
        { timeout: 15_000 },
      )
      .toBe("activated");
    const state = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return {
        scope: registration?.scope,
        updateViaCache: registration?.updateViaCache,
        script: registration?.active?.scriptURL,
        shells: (await caches.keys()).filter((name) => name.startsWith("ni-shell-")).length,
      };
    });
    expect(state).toEqual({
      scope: `${new URL(page.url()).origin}/`,
      updateViaCache: "none",
      script: `${new URL(page.url()).origin}/sw.js`,
      shells: 1,
    });
  });
});
