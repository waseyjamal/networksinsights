import { expect, type Locator, type Page, test } from "@playwright/test";

// Keyboard use of the page frame: the skip link, the header, and the mobile menu, which must
// work with JavaScript switched off.
//
// Safari (and so WebKit) does not put links in the Tab order by default: Tab visits form
// controls only, unless the visitor turns on "Press Tab to highlight each item" or uses
// VoiceOver. So the Tab-order checks run in Chromium and Firefox; in WebKit the same links are
// focused directly and everything after that (Enter, arrow keys) is still tested.

/** Puts focus on `target`: with Tab where Tab reaches links, directly in WebKit. */
async function reach(page: Page, target: Locator, browserName: string) {
  if (browserName === "webkit") await target.focus();
  else await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
}

test.describe("skip link", () => {
  test("is the first stop and moves focus to <main>", async ({ page, browserName }) => {
    await page.goto("/about/");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await reach(page, skip, browserName);
    // It is visible while it has focus, and inside the viewport.
    const box = await skip.boundingBox();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
    await expect(page.locator("main")).toBeFocused();
    // The next Tab goes into the page content, not back through the header.
    if (browserName !== "webkit") {
      await page.keyboard.press("Tab");
      const focusedInMain = await page.evaluate(() =>
        Boolean(document.activeElement?.closest("main")),
      );
      expect(focusedInMain).toBe(true);
    }
  });
});

test.describe("header on a desktop viewport", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("can be used with the keyboard, in reading order", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "Safari's default Tab order skips links");
    await page.goto("/");
    const focusedName = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return (
          el?.getAttribute("aria-label") ||
          el?.textContent?.trim() ||
          (el as HTMLInputElement | null)?.value ||
          ""
        );
      });

    await page.keyboard.press("Tab");
    expect(await focusedName()).toBe("Skip to content");
    await page.keyboard.press("Tab");
    expect(await focusedName()).toBe("NetworksInsights");
    await page.keyboard.press("Tab");
    expect(await focusedName()).toBe("Search tools");
    await page.keyboard.press("Tab");
    expect(await focusedName()).toBe("All tools");
    // The theme toggle is one radio group: a single tab stop, then the arrow keys.
    await page.keyboard.press("Tab");
    const inToggle = await page.evaluate(() =>
      Boolean(document.activeElement?.closest(".ni-header .ni-theme-toggle")),
    );
    expect(inToggle).toBe(true);
    // The hidden mobile menu is skipped: the next stop is in the page.
    await page.keyboard.press("Tab");
    const inMain = await page.evaluate(() => Boolean(document.activeElement?.closest("main")));
    expect(inMain).toBe(true);
  });

  test("shows a focus ring on every header stop", async ({ page, browserName }) => {
    await page.goto("/");
    const header = page.locator(".ni-header");
    const stops = {
      NetworksInsights: header.getByRole("link", { name: "NetworksInsights" }),
      "Search tools": header.getByRole("link", { name: "Search tools" }),
      "All tools": header.getByRole("link", { name: "All tools" }),
    };
    if (browserName !== "webkit") await page.keyboard.press("Tab"); // past the skip link
    for (const [name, stop] of Object.entries(stops)) {
      await reach(page, stop, browserName);
      const outline = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement as Element);
        return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
      });
      expect(outline.style, `${name} has a focus outline`).not.toBe("none");
      expect(outline.width, `${name} outline width`).toBeGreaterThan(0);
    }
  });

  test("the theme toggle changes the theme with the arrow keys", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
    await page.locator('.ni-header__theme input[data-ni-theme][value="light"]').focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("Enter on the command bar opens the list of all tools", async ({ page }) => {
    await page.goto("/");
    const bar = page.locator(".ni-header").getByRole("link", { name: "Search tools" });
    await bar.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/tools\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "All tools" })).toBeVisible();
  });

  test("hides the mobile menu", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".ni-menu")).toBeHidden();
    await expect(page.locator(".ni-header__nav")).toBeVisible();
  });
});

test.describe("mobile menu without JavaScript", () => {
  test.use({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });

  test("opens and closes with the pointer", async ({ page }) => {
    await page.goto("/");
    const summary = page.locator(".ni-menu > summary");
    const panel = page.locator(".ni-menu__panel");
    await expect(summary).toBeVisible();
    await expect(page.locator(".ni-header__nav")).toBeHidden();
    await expect(panel).toBeHidden();

    await summary.click();
    await expect(page.locator(".ni-menu")).toHaveAttribute("open", "");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("link", { name: "PDF tools" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "All tools" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "About" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Search tools" })).toBeVisible();

    await summary.click();
    await expect(panel).toBeHidden();
    await expect(page.locator(".ni-menu")).not.toHaveAttribute("open", "");
  });

  test("opens and closes with the keyboard", async ({ page, browserName }) => {
    await page.goto("/");
    const summary = page.locator(".ni-menu > summary");
    const panel = page.locator(".ni-menu__panel");
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
    // The first stop inside the open menu is its command-bar link, then the category links.
    await reach(page, panel.getByRole("link", { name: "Search tools" }), browserName);
    await reach(page, panel.getByRole("link", { name: "PDF tools" }), browserName);
    await summary.focus();
    await page.keyboard.press("Space");
    await expect(panel).toBeHidden();
  });

  test("a link in the menu goes to its page", async ({ page }) => {
    await page.goto("/");
    await page.locator(".ni-menu > summary").click();
    await page.locator(".ni-menu__panel").getByRole("link", { name: "Image tools" }).click();
    await expect(page).toHaveURL(/\/image-tools\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Image tools" })).toBeVisible();
  });

  test("the whole page still works: skip link target and footer links", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main#main")).toBeAttached();
    await expect(page.locator("footer").getByRole("link", { name: "Privacy" })).toBeVisible();
  });
});
