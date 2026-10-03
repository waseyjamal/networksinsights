import { expect, test } from "@playwright/test";
import manifest from "../../../tools/converters/number-to-words/tool.config";
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

// Number to Words in the three engines, against `wrangler dev` (real CSP and headers). It renders
// the example of its page without JavaScript, switches system and style, refuses one past the
// largest number, and its structured data and Quick facts match.

test.use({ baseURL: edgeURL });

const PATH = "/number-to-words/";

test("renders the example of its page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(page.locator("#ntw-result")).toHaveText(
    "Twelve lakh thirty-four thousand five hundred sixty-seven",
  );
  await context.close();
});

test("switches system and cheque style", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  const result = page.locator("#ntw-result");

  await page.locator("#ntw-system").selectOption("international");
  await expect(result).toHaveText(
    "One million two hundred thirty-four thousand five hundred sixty-seven",
  );
  await page.locator("#ntw-number").fill("1250.50");
  await page.locator("#ntw-style").selectOption("dollars");
  await expect(result).toHaveText("One thousand two hundred fifty dollars and fifty cents");
  await page.locator("#ntw-system").selectOption("indian");
  await page.locator("#ntw-style").selectOption("rupees");
  await expect(result).toHaveText("Rupees one thousand two hundred fifty and fifty paise only");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("writes the largest number and refuses one more", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#ntw-system").selectOption("international");
  await page.locator("#ntw-number").fill("999999999999999");
  await expect(page.locator("#ntw-result")).toHaveText(/^Nine hundred ninety-nine trillion/);
  await page.locator("#ntw-number").fill("1000000000000000");
  await expect(page.locator("#ntw-number-error")).toContainText(
    "the largest supported is 999,999,999,999,999",
  );
  await page.locator("#ntw-number").fill("-5");
  await page.locator("#ntw-style").selectOption("rupees");
  await expect(page.locator("#ntw-number-error")).toHaveText("A cheque amount cannot be negative.");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await page.locator("#ntw-number").fill("abc");
    await expect(page.locator("#ntw-number-error")).toBeVisible();
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
