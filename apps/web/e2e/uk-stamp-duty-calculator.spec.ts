import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/calculators/uk-stamp-duty-calculator/tool.config";
import { collectErrors } from "./helpers";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// UK Stamp Duty Calculator: the spec types gov.uk's own worked examples into the page (a £295,000
// home, a £500,000 first-time buyer, a £300,000 additional property) and reads back the exact
// totals and bands. It also checks the non-resident surcharge, the notes at £500,000 and £40,000,
// a refused price, and the sources and dates the page shows. No tolerance: every figure is exact.

const PATH = "/uk-stamp-duty-calculator/";
const field = (page: Page, key: string) => page.locator(`#sdlt-${key}`);
const cell = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);

/** The cells of a band row, by its label. */
async function band(page: Page, label: string) {
  return page
    .locator("#sdlt-bands tr", { has: page.getByRole("rowheader", { name: label, exact: true }) })
    .locator("td")
    .allInnerTexts();
}

test("gov.uk example: a £295,000 home owes £4,750", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(field(page, "price")).toHaveValue("295,000");
  await expect(cell(page, "total")).toHaveText("£4,750");
  await expect(cell(page, "effective")).toHaveText("1.61%");
  expect(await band(page, "Up to £125,000")).toEqual(["0%", "£125,000", "£0"]);
  expect(await band(page, "£125,001 to £250,000")).toEqual(["2%", "£125,000", "£2,500"]);
  expect(await band(page, "£250,001 to £925,000")).toEqual(["5%", "£45,000", "£2,250"]);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("gov.uk examples: first-time buyer at £500,000 and an additional home at £300,000", async ({
  page,
}) => {
  await openTool(page, PATH);
  await field(page, "price").fill("500,000");
  await field(page, "buyer").selectOption("first");
  await expect(cell(page, "total")).toHaveText("£10,000");
  expect(await band(page, "Above £300,000")).toEqual(["5%", "£200,000", "£10,000"]);
  await field(page, "price").fill("500001");
  await expect(cell(page, "total")).toHaveText("£15,000.05");
  await expect(
    page.getByText("First-time buyer relief does not apply above £500,000"),
  ).toBeVisible();
  await field(page, "price").fill("300000");
  await field(page, "buyer").selectOption("additional");
  await expect(cell(page, "total")).toHaveText("£20,000");
  expect(await band(page, "Up to £125,000")).toEqual(["5%", "£125,000", "£6,250"]);
});

test("adds the 2% non-resident surcharge, and nothing is due below £40,000", async ({ page }) => {
  await openTool(page, PATH);
  await field(page, "non-resident").check();
  await expect(cell(page, "total")).toHaveText("£10,650");
  await field(page, "price").fill("39999");
  await field(page, "buyer").selectOption("additional");
  await expect(cell(page, "total")).toHaveText("£0");
  await expect(page.getByText("No SDLT is due, and no return is needed")).toBeVisible();
});

test("refuses a price that is not whole pounds", async ({ page }) => {
  await openTool(page, PATH);
  await field(page, "price").fill("295000.50");
  await expect(field(page, "price-error")).toHaveText(
    "Enter the price in whole pounds, from 1 to £1,000,000,000.",
  );
  await expect(page.locator("#sdlt-bands")).toHaveCount(0);
  await field(page, "price").fill("125001");
  await expect(cell(page, "total")).toHaveText("£0.02");
});

test("shows the effective date, the review date, the sources and the estimate note", async ({
  page,
}) => {
  await openTool(page, PATH);
  await expect(field(page, "year")).toHaveText(
    "Residential rates in England and Northern Ireland from 1 April 2025. Last reviewed on 8 October 2026.",
  );
  await expect(page.getByText("An estimate, not tax advice", { exact: true })).toBeVisible();
  const links = field(page, "sources").getByRole("link");
  await expect(links).toHaveCount(3);
  for (const href of await links.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")))) {
    expect(href).toMatch(/^https:\/\/www\.gov\.uk\//);
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expect(page.locator("#sdlt-bands")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
