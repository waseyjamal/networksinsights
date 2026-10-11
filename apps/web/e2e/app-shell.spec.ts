import { type Browser, expect, type Page, test } from "@playwright/test";

// The app shell (ADR 0072): the navigation bar and the "Install app" control, in the built site.
// Each install path is shown to the browser it is for, by its user agent or, for Chromium's own
// prompt, by a stand-in `beforeinstallprompt` event; lib/pwa/app-shell.test.ts covers every
// platform decision in Node.

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  instagram:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Instagram 400.0.0.0.0 Android",
};

const install = (page: Page) => page.locator("footer [data-ni-install]");
const dialog = (page: Page) => page.locator("[data-ni-install-dialog]");

async function open(browser: Browser, userAgent: string, init?: () => void) {
  const context = await browser.newContext({ userAgent });
  const page = await context.newPage();
  if (init) await page.addInitScript(init);
  await page.goto("/");
  return { page, close: () => context.close() };
}

test.describe("navigation bar", () => {
  test("shows within 100 ms of a tap on an internal link and is gone on the next page", async ({
    page,
  }) => {
    await page.goto("/");
    // Hold the next page back, so the bar is measured while the browser waits for it.
    await page.route("**/tools/", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });
    const bar = page.locator("[data-ni-nav]");
    await expect(bar).not.toHaveAttribute("data-state", "loading");
    const shownAfter = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const nav = document.querySelector("[data-ni-nav]") as HTMLElement;
          const start = performance.now();
          new MutationObserver(() => resolve(performance.now() - start)).observe(nav, {
            attributes: true,
          });
          (document.querySelector('footer a[href="/tools/"]') as HTMLAnchorElement).click();
        }),
    );
    expect(shownAfter).toBeLessThan(100);
    await page.waitForURL("**/tools/");
    await expect(page.locator("[data-ni-nav]")).not.toHaveAttribute("data-state", "loading");
  });

  test("stays hidden for a link to a part of the same page", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "#main";
      link.textContent = "Skip";
      document.body.append(link);
      link.click();
    });
    await expect(page.locator("[data-ni-nav]")).not.toHaveAttribute("data-state", "loading");
  });
});

test.describe("install control", () => {
  test("Chromium: waits for the browser's prompt, says Installing… at once, then Installed", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "beforeinstallprompt exists only in Chromium");
    await page.goto("/");
    await expect(install(page)).toBeHidden();

    // A stand-in for the browser's prompt. The visitor's answer waits until the test gives it, so
    // the "Installing…" state is checked while the prompt is still open.
    type Answering = { answer?: (choice: { outcome: string }) => void };
    const offer = () =>
      page.evaluate(() => {
        const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
          prompt: () => Promise.resolve(),
          userChoice: new Promise((resolve) => {
            (window as Answering).answer = resolve;
          }),
        });
        window.dispatchEvent(event);
      });
    const answer = (outcome: string) =>
      page.evaluate((choice) => (window as Answering).answer?.({ outcome: choice }), outcome);

    // Dismissed: back to normal, hidden until the browser offers a new prompt.
    await offer();
    await expect(install(page)).toBeVisible();
    await install(page).click();
    await expect(install(page)).toHaveText("Installing…");
    await expect(page.locator("[data-ni-install-status]")).toHaveText("Installing…");
    await answer("dismissed");
    await expect(install(page)).toBeHidden();
    await expect(page.locator("[data-ni-install-status]")).toHaveText("");

    // Accepted: Installing… until the browser says the app is installed.
    await offer();
    await install(page).click();
    await answer("accepted");
    await expect(install(page)).toHaveText("Installing…");
    await expect(install(page)).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect(install(page)).toHaveText("Installed");
    await expect(page.locator("[data-ni-install-status]")).toHaveText("Installed");
  });

  test("iPhone: a dialog with the Share steps, keyboard accessible, Esc closes", async ({
    browser,
  }) => {
    const { page, close } = await open(browser, UA.iphone);
    await expect(install(page)).toBeVisible();
    await install(page).focus();
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator('[data-steps="ios"]')).toBeVisible();
    await expect(dialog(page).locator('[data-steps="ios"]')).toContainText(
      /^Tap Share\s*, then Add to Home Screen\.$/,
    );
    await expect(dialog(page).locator('[data-steps="ios"] svg')).toHaveCount(1);
    for (const steps of ["mac-safari", "firefox-android", "in-app"]) {
      await expect(dialog(page).locator(`[data-steps="${steps}"]`)).toBeHidden();
    }
    // Focus starts inside the dialog and never reaches the page behind it, which is inert. With
    // one control in the dialog, Tab may leave for the browser's own toolbar: then the page's
    // active element is the body, never a page control.
    await expect(dialog(page).getByRole("button", { name: "Close" })).toBeFocused();
    for (let press = 0; press < 3; press++) {
      await page.keyboard.press("Tab");
      const onPageBehind = await page.evaluate(() => {
        const active = document.activeElement;
        return active !== null && active !== document.body && !active.closest("dialog");
      });
      expect(onPageBehind, `after Tab ${press + 1}`).toBe(false);
    }
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect(install(page)).toBeFocused();
    await close();
  });

  test("a social app's browser: asks to open the page in Chrome or Safari", async ({ browser }) => {
    const { page, close } = await open(browser, UA.instagram);
    await install(page).click();
    await expect(dialog(page).locator('[data-steps="in-app"]')).toContainText(
      "Open this page in Chrome or Safari to install it.",
    );
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toBeHidden();
    await close();
  });

  test("Safari on a Mac: File, then Add to Dock", async ({ page, browserName }) => {
    test.skip(browserName !== "webkit", "the Mac steps are for Safari");
    await page.addInitScript(() => {
      (window as unknown as { safari: object }).safari = {};
    });
    await page.goto("/");
    await install(page).click();
    await expect(dialog(page).locator('[data-steps="mac-safari"]')).toContainText(
      "In the menu bar, choose File, then Add to Dock.",
    );
  });

  test("hidden in Firefox on a desktop", async ({ page, browserName }) => {
    test.skip(browserName !== "firefox", "Firefox on a desktop cannot install a site");
    await page.goto("/");
    await expect(page.locator("[data-ni-install]")).toHaveCount(2);
    for (const button of await page.locator("[data-ni-install]").all()) {
      await expect(button).toBeHidden();
    }
  });

  test("hidden once the site runs as the installed app", async ({ browser }) => {
    const { page, close } = await open(browser, UA.iphone, () => {
      Object.defineProperty(navigator, "standalone", { value: true });
    });
    await expect(install(page)).toBeHidden();
    await close();
  });

  test("hidden without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, userAgent: UA.iphone });
    const page = await context.newPage();
    await page.goto("/");
    await expect(install(page)).toBeHidden();
    await context.close();
  });
});
