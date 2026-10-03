import { expect, test } from "@playwright/test";
import manifest from "../../../tools/converters/unit-converter/tool.config";
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

// Unit Converter in the three engines, against `wrangler dev` (real CSP and headers). It renders the
// example of its page without JavaScript, converts across kinds, swaps units, keeps decimal and
// binary data sizes apart, refuses values past its limits, and its structured data and Quick facts match.

test.use({ baseURL: edgeURL });

const PATH = "/unit-converter/";

test("renders the example of its page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(page.locator("#unit-result")).toHaveText("0.621371192237");
  await context.close();
});

test("converts, swaps and labels data sizes", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  const result = page.locator("#unit-result");
  await expect(result).toHaveText("0.621371192237");
  await expect(page.locator("#unit-note")).toHaveText("Rounded to 12 significant digits.");

  await page.getByRole("button", { name: "Swap units" }).click();
  await expect(result).toHaveText("1.609344");
  await expect(page.locator("#unit-note")).toHaveText("Exact.");

  await page.getByLabel("Kind of unit").selectOption("temperature");
  await page.locator("#unit-value").fill("100");
  await expect(result).toHaveText("212");

  await page.getByLabel("Kind of unit").selectOption("data");
  await page.locator("#unit-value").fill("1");
  await page.locator("#unit-from").selectOption("GiB");
  await page.locator("#unit-to").selectOption("GB");
  await expect(result).toHaveText("1.073741824");
  await expect(page.locator("#unit-to").locator("option[value=KiB]")).toHaveText(
    "Kibibyte (KiB, 1,024 bytes)",
  );

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("refuses values past its limits", async ({ page }) => {
  await openTool(page, PATH);
  const value = page.locator("#unit-value");
  await value.fill("1000000000000001");
  await expect(page.locator("#unit-value-error")).toContainText("limit is 1,000,000,000,000,000");
  await value.fill("1000000000000000");
  await expect(page.locator("#unit-value-error")).toHaveCount(0);
  await value.fill("0.0000000000000001");
  await expect(page.locator("#unit-value-error")).toContainText("at most 15 digits");
  await page.getByLabel("Kind of unit").selectOption("temperature");
  await value.fill("-300");
  await expect(page.locator("#unit-value-error")).toContainText("absolute zero");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await page.locator("#unit-value").fill("");
    await expect(page.locator("#unit-value-error")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("its structured data says what the page shows", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
});

test("Quick facts are the manifest's, in order", async ({ page }) => {
  await openTool(page, PATH);
  await expectQuickFacts(page, manifest);
});
