import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/calculators/fd-calculator/tool.config";
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

// FD Calculator in the three engines, against `wrangler dev` (real CSP and headers). It renders the
// example of its page without JavaScript, recalculates for months, days, simple interest and 0%,
// refuses inputs past its limits, and its structured data and Quick facts match.

test.use({ baseURL: edgeURL });

const PATH = "/fd-calculator/";
const cell = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);
const rows = (page: Page) => page.locator("#fd-table tbody tr");

test("renders the example of its page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(cell(page, "maturity")).toHaveText("141,477.82");
  await expect(cell(page, "interest")).toHaveText("41,477.82");
  await expect(rows(page)).toHaveCount(5);
  await context.close();
});

test("recalculates for months, days, simple interest and 0%", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);

  await page.locator("#fd-tenure").fill("30");
  await page.locator("#fd-unit").selectOption("months");
  await expect(cell(page, "maturity")).toHaveText("118,944.45");
  await expect(rows(page).last().locator("th, td").first()).toHaveText("At maturity");

  await page.locator("#fd-tenure").fill("90");
  await page.locator("#fd-unit").selectOption("days");
  await expect(cell(page, "maturity")).toHaveText("101,725.82");

  await page.locator("#fd-tenure").fill("6");
  await page.locator("#fd-unit").selectOption("months");
  await page.locator("#fd-compounding").selectOption("simple");
  await expect(cell(page, "maturity")).toHaveText("103,500.00");

  await page.locator("#fd-rate").fill("0");
  await expect(cell(page, "interest")).toHaveText("0.00");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("refuses inputs past its limits", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#fd-amount").fill("1000000000000.01");
  await expect(page.locator("#fd-amount-error")).toContainText("the limit is 1,000,000,000,000");
  await page.locator("#fd-amount").fill("1000000000000");
  await expect(page.locator("#fd-amount-error")).toHaveCount(0);
  await page.locator("#fd-rate").fill("50.01");
  await expect(page.locator("#fd-rate-error")).toContainText("from 0 to 50 percent");
  await page.locator("#fd-rate").fill("7");
  await page.locator("#fd-tenure").fill("51");
  await expect(page.locator("#fd-tenure-error")).toContainText("from 1 to 50 years");
  await page.locator("#fd-tenure").fill("50");
  await expect(rows(page)).toHaveCount(50);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await page.locator("#fd-rate").fill("");
    await expect(page.locator("#fd-rate-error")).toBeVisible();
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
