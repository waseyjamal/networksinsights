import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/calculators/emi-calculator/tool.config";
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

// EMI Calculator in the three engines, against `wrangler dev` (real CSP and headers). It renders
// the example of its page without JavaScript, recalculates from each box, reads years and months,
// handles a 0% rate, explains every refused input, and its structured data and Quick facts match.

test.use({ baseURL: edgeURL });

const PATH = "/emi-calculator/";
const cell = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);
const amount = (page: Page) => page.locator("#emi-amount");
const rate = (page: Page) => page.locator("#emi-rate");
const tenure = (page: Page) => page.locator("#emi-tenure");
const rows = (page: Page) => page.locator("#emi-schedule tbody tr");

async function expectExample(page: Page) {
  await expect(cell(page, "emi")).toHaveText("10,258.27");
  await expect(cell(page, "interest")).toHaveText("115,495.94");
  await expect(cell(page, "payment")).toHaveText("615,495.94");
  await expect(cell(page, "months")).toHaveText("60");
  await expect(rows(page)).toHaveCount(60);
  await expect(rows(page).first().locator("th, td")).toHaveText([
    "1",
    "10,258.27",
    "6,716.60",
    "3,541.67",
    "493,283.40",
  ]);
  await expect(rows(page).last().locator("td").last()).toHaveText("0.00");
}

test("renders the example of its page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expectExample(page);
  await context.close();
});

test("recalculates from each box, in years or months, and at 0%", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expectExample(page);

  await amount(page).fill("100000");
  await rate(page).fill("12");
  await tenure(page).fill("12");
  await page.getByLabel("Tenure in").selectOption("months");
  await expect(cell(page, "emi")).toHaveText("8,884.88");
  await expect(cell(page, "interest")).toHaveText("6,618.55");
  await expect(rows(page)).toHaveCount(12);

  await tenure(page).fill("1");
  await page.getByLabel("Tenure in").selectOption("years");
  await expect(cell(page, "emi")).toHaveText("8,884.88");

  await amount(page).fill("1,200");
  await rate(page).fill("0");
  await expect(cell(page, "emi")).toHaveText("100.00");
  await expect(cell(page, "interest")).toHaveText("0.00");
  await expect(cell(page, "payment")).toHaveText("1,200.00");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("explains every refused input", async ({ page }) => {
  await openTool(page, PATH);
  await amount(page).fill("");
  await expect(page.locator("#emi-amount-error")).toHaveText("Enter the loan amount.");
  await expect(cell(page, "emi")).toHaveCount(0);
  await amount(page).fill("0");
  await expect(page.locator("#emi-amount-error")).toHaveText(
    "The loan amount must be more than 0.",
  );
  await amount(page).fill("500000");

  await rate(page).fill("101");
  await expect(page.locator("#emi-rate-error")).toHaveText(
    "The yearly interest rate must be from 0 to 100 percent.",
  );
  await rate(page).fill("abc");
  await expect(page.locator("#emi-rate-error")).toContainText("is not a number");
  await rate(page).fill("8.5");

  await tenure(page).fill("0.01");
  await expect(page.locator("#emi-tenure-error")).toContainText("whole number of months");
  await tenure(page).fill("51");
  await expect(page.locator("#emi-tenure-error")).toContainText("from 1 month to 600 months");
  await tenure(page).fill("50");
  await expect(page.locator("#emi-tenure-error")).toHaveCount(0);
  await expect(rows(page)).toHaveCount(600);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await rate(page).fill("");
    await expect(page.locator("#emi-rate-error")).toBeVisible();
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
