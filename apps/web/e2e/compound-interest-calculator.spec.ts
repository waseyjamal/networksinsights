import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/calculators/compound-interest-calculator/tool.config";
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

// Compound Interest Calculator in the three engines, against `wrangler dev` (real CSP and
// headers). It renders the example of its page without JavaScript, recalculates from each box and
// each frequency, adds a regular deposit, states that it is not a forecast, explains every refused
// input, and its structured data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/compound-interest-calculator/";
const cell = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);
const field = (page: Page, name: string) => page.locator(`#ci-${name}`);
const rows = (page: Page) => page.locator("#ci-years-table tbody tr");

async function expectExample(page: Page) {
  await expect(cell(page, "end")).toHaveText("16,470.09");
  await expect(cell(page, "interest")).toHaveText("6,470.09");
  await expect(cell(page, "contributed")).toHaveText("10,000.00");
  await expect(rows(page)).toHaveCount(10);
  await expect(rows(page).first().locator("th, td")).toHaveText([
    "1",
    "10,000.00",
    "0.00",
    "511.62",
    "10,511.62",
  ]);
}

test("renders the example of its page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expectExample(page);
  await expect(
    page.getByText("It is not a forecast and not financial advice.", { exact: false }),
  ).toBeVisible();
  await context.close();
});

test("recalculates from each box, frequency and a regular deposit", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expectExample(page);

  await page.getByLabel("Interest is added").selectOption("1");
  await expect(cell(page, "end")).toHaveText("16,288.95");
  await page.getByLabel("Interest is added").selectOption("12");
  await expectExample(page);

  await field(page, "principal").fill("5,000");
  await field(page, "rate").fill("6");
  await field(page, "years").fill("20");
  await field(page, "deposit").fill("200");
  await expect(cell(page, "end")).toHaveText("108,959.20");
  await expect(cell(page, "interest")).toHaveText("55,959.20");
  await expect(cell(page, "contributed")).toHaveText("53,000.00");
  await expect(rows(page)).toHaveCount(20);
  await expect(rows(page).first().locator("th, td")).toHaveText([
    "1",
    "5,000.00",
    "2,400.00",
    "375.50",
    "7,775.50",
  ]);

  await field(page, "principal").fill("0");
  await field(page, "rate").fill("0");
  await field(page, "years").fill("2");
  await expect(cell(page, "end")).toHaveText("4,800.00");
  await expect(cell(page, "interest")).toHaveText("0.00");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("explains every refused input", async ({ page }) => {
  await openTool(page, PATH);
  await field(page, "principal").fill("");
  await expect(page.locator("#ci-principal-error")).toHaveText(
    "Enter the starting amount, or 0 if you start with none.",
  );
  await expect(cell(page, "end")).toHaveCount(0);
  await field(page, "principal").fill("0");
  await expect(page.locator("#ci-principal-error")).toHaveText(
    "Enter a starting amount or a regular deposit that is more than 0.",
  );
  await field(page, "principal").fill("10000");

  await field(page, "rate").fill("101");
  await expect(page.locator("#ci-rate-error")).toHaveText(
    "The yearly interest rate must be from 0 to 100 percent.",
  );
  await field(page, "rate").fill("five");
  await expect(page.locator("#ci-rate-error")).toContainText("is not a number");
  await field(page, "rate").fill("5");

  for (const years of ["0", "101", "2.5"]) {
    await field(page, "years").fill(years);
    await expect(page.locator("#ci-years-error")).toHaveText(
      "The number of years must be a whole number from 1 to 100.",
    );
  }
  await field(page, "years").fill("100");
  await expect(page.locator("#ci-years-error")).toHaveCount(0);
  await expect(rows(page)).toHaveCount(100);

  await field(page, "deposit").fill("-5");
  await expect(page.locator("#ci-deposit-error")).toContainText("from 0 to 1,000,000,000,000");
  await field(page, "deposit").fill("");
  await expect(page.locator("#ci-deposit-error")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await field(page, "rate").fill("");
    await expect(page.locator("#ci-rate-error")).toBeVisible();
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
