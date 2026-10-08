import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/calculators/us-federal-income-tax-calculator/tool.config";
import { collectErrors } from "./helpers";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// US Federal Income Tax Calculator: the spec types taxable incomes at the bracket edges of the
// 2026 rate schedules in Rev. Proc. 2025-32 and reads back the IRS's own base amounts ("$5,800
// plus 22% of the excess over $50,400"), for each filing status, then the page example with the
// standard deduction, itemized deductions, a refused amount, and the sources and dates shown.
// No tolerance: every figure is exact to the cent.

const PATH = "/us-federal-income-tax-calculator/";
const field = (page: Page, key: string) => page.locator(`#us-tax-${key}`);
const cell = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);

test("page example: single, $100,000 with the standard deduction owes $13,170.00", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(field(page, "income")).toHaveValue("100,000");
  await expect(cell(page, "deduction")).toHaveText("$16,100");
  await expect(cell(page, "taxable")).toHaveText("$83,900");
  await expect(cell(page, "tax")).toHaveText("$13,170.00");
  await expect(cell(page, "marginal")).toHaveText("22%");
  await expect(cell(page, "effective")).toHaveText("13.17%");
  const rows = page.locator("#us-tax-brackets tbody tr");
  await expect(rows.nth(2).locator("td")).toHaveText(["22%", "$33,500", "$7,370.00"]);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("matches the Rev. Proc. 2025-32 base amounts for every filing status", async ({ page }) => {
  await openTool(page, PATH);
  await field(page, "deduction").selectOption("none");
  const cases: ReadonlyArray<[string, string, string]> = [
    ["single", "50400", "$5,800.00"],
    ["single", "640600", "$192,979.25"],
    ["joint", "768700", "$206,583.50"],
    ["head", "201750", "$39,207.00"],
    ["separate", "384350", "$103,291.75"],
  ];
  for (const [status, income, tax] of cases) {
    await field(page, "status").selectOption(status);
    await field(page, "income").fill(income);
    await expect(cell(page, "tax")).toHaveText(tax);
  }
  // One dollar over the separate-return top edge is taxed at 37%.
  await field(page, "income").fill("384351");
  await expect(cell(page, "tax")).toHaveText("$103,292.12");
  await expect(cell(page, "marginal")).toHaveText("37%");
});

test("takes itemized deductions, and refuses amounts that are not whole dollars", async ({
  page,
}) => {
  await openTool(page, PATH);
  await field(page, "status").selectOption("joint");
  await field(page, "income").fill("80,000");
  await field(page, "deduction").selectOption("itemized");
  await field(page, "itemized").fill("40,000");
  await expect(cell(page, "taxable")).toHaveText("$40,000");
  await expect(cell(page, "tax")).toHaveText("$4,304.00");
  await field(page, "itemized").fill("-1");
  await expect(field(page, "itemized-error")).toHaveText(
    "Enter your itemized deductions in whole dollars, from 0 to $1,000,000,000.",
  );
  await field(page, "income").fill("");
  await expect(field(page, "income-error")).toHaveText(
    "Enter the income in whole dollars, from 0 to $1,000,000,000.",
  );
  await expect(page.locator("#us-tax-brackets")).toHaveCount(0);
});

test("shows the tax year, the review date, the IRS sources and the estimate note", async ({
  page,
}) => {
  await openTool(page, PATH);
  await expect(field(page, "year")).toHaveText(
    "Tax year 2026 (returns filed in 2027), federal income tax only. Last reviewed on 8 October 2026.",
  );
  await expect(page.getByText("An estimate, not tax advice", { exact: true })).toBeVisible();
  await expect(page.locator(".ni-alert", { hasText: "An estimate, not tax advice" })).toContainText(
    "It leaves out state and local income tax",
  );
  const links = field(page, "sources").getByRole("link");
  await expect(links).toHaveCount(2);
  for (const href of await links.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")))) {
    expect(href).toMatch(/^https:\/\/www\.irs\.gov\//);
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expect(page.locator("#us-tax-brackets")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
