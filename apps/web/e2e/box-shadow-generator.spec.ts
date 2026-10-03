import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/color-design/box-shadow-generator/tool.config";
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

// Box Shadow Generator against `wrangler dev` (real CSP and headers): the examples of its page,
// the glass card preset, the five-layer limit, the ranges at and over their edges, and axe.

test.use({ baseURL: edgeURL });

const PATH = "/box-shadow-generator/";
const css = (page: Page) => page.locator("#shadow-css");
const START = "box-shadow: 0px 4px 12px 0px rgba(0, 0, 0, 0.25);";

test("renders its starting shadow without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(css(page)).toHaveValue(START);
  await context.close();
});

test("edits a layer, adds an inset one, and draws it", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await page.locator("#shadow-y-1").fill("8");
  await page.getByRole("button", { name: "Add layer" }).click();
  await page.locator("#shadow-inset-2").check();
  await page.locator("#shadow-color-2").fill("#ff8800");
  await page.locator("#shadow-opacity-2").fill("50");
  await expect(css(page)).toHaveValue(
    "box-shadow: 0px 8px 12px 0px rgba(0, 0, 0, 0.25), inset 0px 4px 12px 0px rgba(255, 136, 0, 0.5);",
  );
  await expect(page.locator("#shadow-preview")).toHaveCSS("box-shadow", /inset/);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("the glass card preset gives the five lines of the page", async ({ page }) => {
  await openTool(page, PATH);
  await page.getByRole("button", { name: "Glass card preset" }).click();
  await expect(css(page)).toHaveValue(
    [
      "box-shadow: 0px 8px 32px 0px rgba(0, 0, 0, 0.2), inset 0px 1px 0px 0px rgba(255, 255, 255, 0.4);",
      "background-color: rgba(255, 255, 255, 0.15);",
      "backdrop-filter: blur(12px);",
      "-webkit-backdrop-filter: blur(12px);",
      "border: 1px solid rgba(255, 255, 255, 0.3);",
    ].join("\n"),
  );
  await page.locator("#shadow-glass").uncheck();
  await expect(css(page)).not.toHaveValue(/backdrop-filter/);
  await expect(page.locator("main")).toContainText("is not supported in every browser version");
});

test("allows five layers and no more", async ({ page }) => {
  await openTool(page, PATH);
  const add = page.getByRole("button", { name: "Add layer" });
  for (let i = 0; i < 4; i++) await add.click();
  await expect(page.locator("#shadow-x-5")).toBeVisible();
  await expect(add).toBeDisabled();
});

test("takes a range at its edge and refuses one over, keeping the last shadow", async ({
  page,
}) => {
  await openTool(page, PATH);
  await page.locator("#shadow-x-1").fill("101");
  await expect(page.locator("#shadow-error")).toHaveText(
    "Layer 1: Horizontal offset must be from -100 to 100.",
  );
  await expect(css(page)).toHaveValue(START);
  await page.locator("#shadow-x-1").fill("100");
  await page.locator("#shadow-spread-1").fill("-50");
  await expect(css(page)).toHaveValue("box-shadow: 100px 4px 12px -50px rgba(0, 0, 0, 0.25);");
  await page.locator("#shadow-blur-1").fill("-1");
  await expect(page.locator("#shadow-error")).toHaveText("Layer 1: Blur must be from 0 to 100.");
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
    await page.getByRole("button", { name: "Glass card preset" }).click();
    await page.locator("#shadow-blur-1").fill("500");
    await expect(page.locator("#shadow-error")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
