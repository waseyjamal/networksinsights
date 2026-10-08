import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/calculators/canada-mortgage-calculator/tool.config";
import { collectErrors } from "./helpers";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Canada Mortgage Payment Calculator: the spec reads the page example back (a $500,000 home with
// CMHC's minimum $25,000 down, the 4.00% premium of the CMHC table at 95% loan to value, and the
// half-yearly-compounded payment), then $100,000 at 6% over 25 years, $639.81 a month and not
// the $644.30 of monthly compounding. Then the down payment rules and the sources shown.
// No tolerance: every figure is exact to the cent.

const PATH = "/canada-mortgage-calculator/";
const field = (page: Page, key: string) => page.locator(`#canada-mortgage-${key}`);
const cell = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);
const rows = (page: Page) => page.locator("#canada-mortgage-schedule tbody tr");

test("page example: $500,000 with the minimum down, CMHC premium added", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(cell(page, "minimum")).toHaveText("$25,000.00");
  await expect(cell(page, "ltv")).toHaveText("95.00%");
  await expect(cell(page, "premium")).toHaveText("$19,000.00 (4.00%)");
  await expect(cell(page, "mortgage")).toHaveText("$494,000.00");
  await expect(cell(page, "payment")).toHaveText("$2,873.13");
  await expect(cell(page, "interest")).toHaveText("$367,938.25");
  await expect(cell(page, "count")).toHaveText("300");
  await expect(rows(page)).toHaveCount(25);
  await expect(rows(page).nth(24).locator("td").last()).toHaveText("$0.00");
  await field(page, "frequency").selectOption("bi-weekly");
  await expect(cell(page, "payment")).toHaveText("$1,324.59");
  await expect(cell(page, "count")).toHaveText("650");
  await field(page, "premium-paid").selectOption("separate");
  await expect(cell(page, "mortgage")).toHaveText("$475,000.00");
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("compounds half-yearly: $100,000 at 6% over 25 years is $639.81 a month", async ({ page }) => {
  await openTool(page, PATH);
  await field(page, "price").fill("125000");
  await field(page, "down").fill("25000");
  await field(page, "rate").fill("6");
  await expect(cell(page, "premium")).toHaveText("None: 20% or more down");
  await expect(cell(page, "mortgage")).toHaveText("$100,000.00");
  await expect(cell(page, "payment")).toHaveText("$639.81");
  await expect(rows(page).nth(0).locator("td").first()).toHaveText("$7,677.72");
});

test("enforces CMHC's minimum down payment and the $1,500,000 limit", async ({ page }) => {
  await openTool(page, PATH);
  await field(page, "price").fill("600,000");
  await field(page, "down").fill("34,999.99");
  await expect(field(page, "down-error")).toHaveText(
    "The minimum down payment on this price is $35,000.00: 5% of the first $500,000 and 10% of the rest.",
  );
  await expect(page.locator("#canada-mortgage-schedule")).toHaveCount(0);
  await field(page, "down").fill("35,000");
  await expect(cell(page, "premium")).toHaveText("$22,600.00 (4.00%)");
  await field(page, "price").fill("1,500,000");
  await field(page, "down").fill("150,000");
  await expect(field(page, "down-error")).toHaveText(
    "Mortgage loan insurance is not available on a home of $1,500,000 or more, so the down payment must be at least 20%.",
  );
  await field(page, "down").fill("300,000");
  await expect(cell(page, "premium")).toHaveText("None: 20% or more down");
  await field(page, "price").fill("2,000,000");
  await field(page, "down").fill("399,999.99");
  await expect(field(page, "down-error")).toHaveText(
    "Mortgage loan insurance is not available on a home of $1,500,000 or more, so the down payment must be at least 20%.",
  );
});

test("shows the compounding, the review date and the official sources", async ({ page }) => {
  await openTool(page, PATH);
  await expect(field(page, "rules")).toHaveText(
    "Fixed rate, compounded half-yearly. CMHC figures last reviewed on 8 October 2026.",
  );
  await expect(page.getByText("An estimate, not financial advice", { exact: true })).toBeVisible();
  const links = field(page, "sources").getByRole("link");
  await expect(links).toHaveCount(3);
  for (const href of await links.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")))) {
    expect(href).toMatch(/^https:\/\/(www\.cmhc-schl\.gc\.ca|laws-lois\.justice\.gc\.ca)\//);
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expect(page.locator("#canada-mortgage-schedule")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
