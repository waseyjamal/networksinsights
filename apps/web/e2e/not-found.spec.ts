import { expect, test } from "@playwright/test";

// Every URL has a trailing slash (astro.config.mjs). `astro preview` serves the 404 page for the
// canonical form only, so the test uses it.
const unknownPath = "/this-page-does-not-exist/";

test.describe("404 page", () => {
  test("an unknown path responds with status 404", async ({ page }) => {
    const response = await page.goto(unknownPath);
    expect(response?.status()).toBe(404);
  });

  test("shows the not-found page in the site frame", async ({ page }) => {
    await page.goto(unknownPath);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page).toHaveTitle("Page not found | NetworksInsights");
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });

  test("is marked noindex", async ({ page }) => {
    await page.goto(unknownPath);
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("links back to the home page", async ({ page }) => {
    await page.goto(unknownPath);
    await expect(page.getByRole("link", { name: "Go to the home page" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
