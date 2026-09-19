import { expect, test } from "@playwright/test";

test.describe("home page", () => {
  test("responds with status 200", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
  });

  test("shows the main heading", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("hydrates the React island", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Interactive: yes")).toBeVisible();
  });

  test("logs no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      errors.push(`pageerror: ${error.message}`);
    });

    await page.goto("/");
    // Wait for hydration so errors thrown while the island starts are captured.
    await expect(page.getByText("Interactive: yes")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("has a title and a meta description", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/\S/);
    await expect(page.locator('head meta[name="description"]')).toHaveAttribute("content", /\S/);
  });
});
