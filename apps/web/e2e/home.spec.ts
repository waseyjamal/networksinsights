import { expect, test } from "@playwright/test";
import { categories } from "../src/config/categories";
import { siteTools } from "./pages";

test.describe("home page", () => {
  test("shows the main heading and the subtitle", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Free online tools. Private by design." }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Convert, compress, calculate and create right in your browser. No sign-up needed.",
      ),
    ).toBeVisible();
  });

  test("no longer says the site is under construction", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).not.toContainText("under construction");
  });

  test("has a command bar that is a real link to all tools", async ({ page }) => {
    await page.goto("/");
    const bar = page.locator("main .ni-commandbar");
    await expect(bar).toHaveJSProperty("tagName", "A");
    await expect(bar).toHaveAttribute("href", "/tools/");
  });

  test("shows every category as a tile with its real count, or Coming soon", async ({ page }) => {
    await page.goto("/");
    const tiles = page.locator("main .ni-tile");
    await expect(tiles).toHaveCount(categories.length);
    for (const category of categories) {
      const tile = page.locator(`main .ni-tile[href="/${category.slug}/"]`);
      await expect(tile).toContainText(category.name);
      const count = siteTools.filter((tool) => tool.category === category.id).length;
      if (count === 0) {
        await expect(tile).toContainText("Coming soon");
        await expect(tile).not.toContainText(/\d+\s+tools?\b/);
      } else {
        await expect(tile.locator(".ni-tile__meta")).toHaveText(
          `${count} ${count === 1 ? "tool" : "tools"}`,
        );
      }
    }
  });

  test("explains why NetworksInsights, in four points", async ({ page }) => {
    await page.goto("/");
    const section = page.getByRole("region", { name: "Why NetworksInsights" });
    await expect(section.getByRole("heading", { level: 3 })).toHaveText([
      "Private by design",
      "Free",
      "Fast",
      "No sign-up",
    ]);
    await expect(section).toContainText("Pages load quickly, even on slow connections.");
    await expect(section).toContainText("Every tool is free to use.");
  });

  test("is complete HTML without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("main .ni-tile")).toHaveCount(categories.length);
    await expect(page.locator("footer")).toBeVisible();
    await context.close();
  });
});
