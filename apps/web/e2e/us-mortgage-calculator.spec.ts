import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/calculators/us-mortgage-calculator/tool.config";
import { collectErrors } from "./helpers";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// US Mortgage Calculator: the spec reads the page example ($200,000 at 6% over 30 years) back
// from the page: the $1,199.10 payment, the first rows of the amortization table worked by hand
// at 0.5% a month, the 360th row at nil and the totals. Then PMI and an extra payment, a 0% loan
// and the refused inputs. No tolerance: every figure is exact to the cent.

const PATH = "/us-mortgage-calculator/";
const field = (page: Page, key: string) => page.locator(`#us-mortgage-${key}`);
const cell = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);
const rows = (page: Page) => page.locator("#us-mortgage-schedule tbody tr");

test("page example: $200,000 at 6% for 30 years, with tax and insurance", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(cell(page, "loan")).toHaveText("$200,000.00");
  await expect(cell(page, "pi")).toHaveText("$1,199.10");
  await expect(cell(page, "tax")).toHaveText("$250.00");
  await expect(cell(page, "insurance")).toHaveText("$100.00");
  await expect(cell(page, "monthly")).toHaveText("$1,549.10");
  await expect(cell(page, "interest")).toHaveText("$231,677.04");
  await expect(cell(page, "paid")).toHaveText("$431,677.04");
  await expect(cell(page, "payoff")).toHaveText("30 years");
  await expect(rows(page)).toHaveCount(30);
  await expect(rows(page).nth(0).locator("td")).toHaveText([
    "$14,389.20",
    "$2,456.01",
    "$11,933.19",
    "$197,543.99",
  ]);
  await field(page, "view").selectOption("month");
  await expect(rows(page)).toHaveCount(360);
  await expect(rows(page).nth(0).locator("td")).toHaveText([
    "$1,199.10",
    "$199.10",
    "$1,000.00",
    "$199,800.90",
  ]);
  await expect(rows(page).nth(1).locator("td")).toHaveText([
    "$1,199.10",
    "$200.10",
    "$999.00",
    "$199,600.80",
  ]);
  await expect(rows(page).nth(359).locator("td").last()).toHaveText("$0.00");
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("adds PMI to the month, and an extra $200 pays the loan off in 21 years", async ({ page }) => {
  await openTool(page, PATH);
  await field(page, "pmi").fill("75.50");
  await expect(cell(page, "pmi")).toHaveText("$75.50");
  await expect(cell(page, "monthly")).toHaveText("$1,624.60");
  await field(page, "extra").fill("200");
  await expect(cell(page, "payoff")).toHaveText("21 years");
  await expect(cell(page, "interest")).toHaveText("$151,876.18");
  await expect(cell(page, "paid")).toHaveText("$351,876.18");
  await expect(rows(page)).toHaveCount(21);
  await field(page, "view").selectOption("month");
  await expect(rows(page)).toHaveCount(252);
  await expect(rows(page).nth(0).locator("td").first()).toHaveText("$1,399.10");
});

test("splits a 0% loan evenly", async ({ page }) => {
  await openTool(page, PATH);
  await field(page, "price").fill("120000");
  await field(page, "down").fill("0");
  await field(page, "rate").fill("0");
  await field(page, "years").fill("1");
  await expect(cell(page, "pi")).toHaveText("$10,000.00");
  await expect(cell(page, "interest")).toHaveText("$0.00");
  await field(page, "view").selectOption("month");
  await expect(rows(page)).toHaveCount(12);
});

test("explains every refused input", async ({ page }) => {
  await openTool(page, PATH);
  await field(page, "down").fill("250,000");
  await expect(field(page, "down-error")).toHaveText(
    "The down payment must be less than the home price.",
  );
  await expect(page.locator("#us-mortgage-schedule")).toHaveCount(0);
  await field(page, "down").fill("50,000");
  await field(page, "rate").fill("31");
  await expect(field(page, "rate-error")).toHaveText(
    "Enter the interest rate as a percent from 0 to 30, with at most three decimals.",
  );
  await field(page, "rate").fill("6");
  await field(page, "years").fill("0");
  await expect(field(page, "years-error")).toHaveText(
    "Enter the term as whole years, from 1 to 40.",
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expect(page.locator("#us-mortgage-schedule")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
