import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/generators/lorem-ipsum-generator/tool.config";
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

// Filler Text Generator in the three engines, against `wrangler dev` (real CSP and headers). It
// renders its first text without JavaScript, makes paragraphs, sentences and words, generates new
// text, makes the maximum and refuses one more, and its structured data and Quick facts match.

test.use({ baseURL: edgeURL });

const PATH = "/lorem-ipsum-generator/";
const paragraphs = (page: Page) => page.locator("#lorem-result p");
const CLASSIC = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";

test("renders its first text without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(paragraphs(page)).toHaveCount(3);
  await expect(paragraphs(page).first()).toHaveText(new RegExp(`^${CLASSIC}`));
  await context.close();
});

test("makes each unit and generates new text", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  const first = await paragraphs(page).first().textContent();

  await page.getByRole("button", { name: "Generate again" }).click();
  await expect(paragraphs(page).first()).not.toHaveText(first ?? "");
  await expect(paragraphs(page).first()).toHaveText(new RegExp(`^${CLASSIC}`));

  await page.locator("#lorem-unit").selectOption("words");
  await page.locator("#lorem-count").fill("5");
  await expect(paragraphs(page)).toHaveText(["Lorem ipsum dolor sit amet."]);
  await page.getByLabel("Start with the classic opening").uncheck();
  await expect(paragraphs(page).first()).not.toHaveText(/^Lorem/);
  await expect(page.locator('[data-stat="words"] dd')).toHaveText("5");

  await page.locator("#lorem-unit").selectOption("sentences");
  await page.locator("#lorem-count").fill("4");
  await expect(paragraphs(page)).toHaveCount(1);
  await expect(paragraphs(page).first()).toHaveText(/^([^.]+\.\s?){4}$/);

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("makes the maximum and refuses one more", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#lorem-count").fill("100");
  await expect(paragraphs(page)).toHaveCount(100);
  await page.locator("#lorem-count").fill("101");
  await expect(page.locator("#lorem-count-error")).toHaveText(
    "Enter a whole number of paragraphs from 1 to 100.",
  );
  await page.locator("#lorem-unit").selectOption("words");
  await page.locator("#lorem-count").fill("10000");
  await expect(page.locator('[data-stat="words"] dd')).toHaveText("10,000");
  await page.locator("#lorem-count").fill("10001");
  await expect(page.locator("#lorem-count-error")).toContainText("from 1 to 10,000");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await page.locator("#lorem-count").fill("0");
    await expect(page.locator("#lorem-count-error")).toBeVisible();
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
