import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/calculators/sip-calculator/tool.config";
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

// SIP Calculator in the three engines, against `wrangler dev` (real CSP and headers). It renders the
// example of its page without JavaScript, recalculates from each box, handles a 0% return, explains
// refused inputs at its limits, and its structured data and Quick facts match.

test.use({ baseURL: edgeURL });

const PATH = "/sip-calculator/";
const cell = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);
const rows = (page: Page) => page.locator("#sip-table tbody tr");

async function expectExample(page: Page) {
  await expect(cell(page, "invested")).toHaveText("600,000.00");
  await expect(cell(page, "returns")).toHaveText("561,695.38");
  await expect(cell(page, "total")).toHaveText("1,161,695.38");
  await expect(rows(page)).toHaveCount(10);
  await expect(rows(page).first().locator("th, td")).toHaveText([
    "1",
    "60,000.00",
    "4,046.64",
    "64,046.64",
  ]);
}

test("renders the example of its page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expectExample(page);
  await context.close();
});

test("recalculates from each box and at 0%", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expectExample(page);

  await page.locator("#sip-amount").fill("1,000");
  await page.locator("#sip-rate").fill("0");
  await page.locator("#sip-years").fill("2");
  await expect(cell(page, "total")).toHaveText("24,000.00");
  await expect(cell(page, "returns")).toHaveText("0.00");
  await expect(rows(page)).toHaveCount(2);

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("explains refused inputs at the limits", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#sip-amount").fill("");
  await expect(page.locator("#sip-amount-error")).toHaveText("Enter the monthly investment.");
  await page.locator("#sip-amount").fill("10000000.01");
  await expect(page.locator("#sip-amount-error")).toContainText("the limit is 10,000,000");
  await page.locator("#sip-amount").fill("10000000");
  await expect(page.locator("#sip-amount-error")).toHaveCount(0);

  await page.locator("#sip-rate").fill("50.01");
  await expect(page.locator("#sip-rate-error")).toContainText("from 0 to 50 percent");
  await page.locator("#sip-rate").fill("50");

  await page.locator("#sip-years").fill("51");
  await expect(page.locator("#sip-years-error")).toContainText("from 1 to 50");
  await page.locator("#sip-years").fill("50");
  await expect(rows(page)).toHaveCount(50);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await page.locator("#sip-rate").fill("");
    await expect(page.locator("#sip-rate-error")).toBeVisible();
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
