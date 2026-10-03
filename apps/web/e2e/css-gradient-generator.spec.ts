import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/color-design/css-gradient-generator/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// CSS Gradient Generator against `wrangler dev` (real CSP and headers): the examples of its page,
// the 2 to 6 stop limits, an invalid colour keeping the last gradient, and axe in both themes.

test.use({ baseURL: edgeURL });

const PATH = "/css-gradient-generator/";
const css = (page: Page) => page.locator("#gradient-css");
const preview = (page: Page) => page.locator("#gradient-preview");

test("renders its starting gradient without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(css(page)).toHaveValue(
    "background-image: linear-gradient(90deg, #3b82f6 0%, #ff8800 100%);",
  );
  await context.close();
});

test("writes the examples of its page and draws them", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await page.locator("#gradient-kind").selectOption("conic");
  await page.locator("#gradient-angle").fill("45");
  await expect(css(page)).toHaveValue(
    "background-image: conic-gradient(from 45deg, #3b82f6 0%, #ff8800 100%);",
  );
  await expect(preview(page)).toHaveCSS("background-image", /conic-gradient/);
  await page.locator("#gradient-kind").selectOption("radial");
  await page.locator("#gradient-shape").selectOption("ellipse");
  await page.locator("#gradient-color-2").fill("#f80");
  await expect(css(page)).toHaveValue(
    "background-image: radial-gradient(ellipse, #3b82f6 0%, #ff8800 100%);",
  );
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("allows 2 to 6 stops and no more", async ({ page }) => {
  await openTool(page, PATH);
  const add = page.getByRole("button", { name: "Add stop" });
  await expect(page.getByRole("button", { name: "Remove stop 1" })).toBeDisabled();
  for (let i = 0; i < 4; i++) await add.click();
  await expect(page.locator("#gradient-color-6")).toBeVisible();
  await expect(add).toBeDisabled();
  await page.getByRole("button", { name: "Remove stop 6" }).click();
  await expect(add).toBeEnabled();
});

test("names an invalid stop and keeps the last gradient", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#gradient-color-1").fill("#3b82f680");
  await expect(page.locator("#gradient-error")).toHaveText(
    "Stop 1: use a HEX colour with 3 or 6 digits, such as #3b82f6.",
  );
  await expect(css(page)).toHaveValue(
    "background-image: linear-gradient(90deg, #3b82f6 0%, #ff8800 100%);",
  );
  await page.locator("#gradient-angle").fill("361");
  await page.locator("#gradient-color-1").fill("#000");
  await expect(page.locator("#gradient-error")).toHaveText(
    "The angle must be a number from 0 to 360 degrees.",
  );
  await page.locator("#gradient-angle").fill("360");
  await expect(css(page)).toHaveValue(
    "background-image: linear-gradient(360deg, #000000 0%, #ff8800 100%);",
  );
});

test("copies the CSS", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium lets a test grant clipboard access");
  await context.grantPermissions(["clipboard-write"]);
  await openTool(page, PATH);
  await page.getByRole("button", { name: "Copy CSS" }).click();
  await expect(page.getByText("CSS copied to the clipboard.")).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await page.locator("#gradient-color-1").fill("nope");
    await expect(page.locator("#gradient-error")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
