import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/calculators/income-tax-calculator-india/tool.config";
import { collectErrors } from "./helpers";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Income Tax Calculator India: every figure is worked out on the page as the visitor types. The
// spec reads the table and the summary back and checks them against sums done by hand from the
// rules the page lists for tax year 2026-27, including both marginal reliefs, the age slabs of the
// old regime, the input limits, and the sources and date the page shows.

const PATH = "/income-tax-calculator-india/";
const field = (page: Page, key: string) => page.locator(`#income-tax-${key}`);
const summary = (page: Page) => field(page, "summary");

/** The New and Old cells of a row of the table, by its label. */
async function row(page: Page, label: string) {
  const cells = page
    .locator("#income-tax-table tr", {
      has: page.getByRole("rowheader", { name: label, exact: true }),
    })
    .locator("td");
  return cells.allInnerTexts();
}

test("works out the page example: ₹97,500 new against ₹1,95,000 old", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(field(page, "salary")).toHaveValue("15,00,000");
  await expect(field(page, "deductions")).toHaveValue("2,00,000");
  expect(await row(page, "Standard deduction on salary")).toEqual(["₹75,000", "₹50,000"]);
  expect(await row(page, "Other deductions (old regime only)")).toEqual(["₹0", "₹2,00,000"]);
  expect(await row(page, "Taxable income")).toEqual(["₹14,25,000", "₹12,50,000"]);
  expect(await row(page, "Tax on the slabs")).toEqual(["₹93,750", "₹1,87,500"]);
  expect(await row(page, "Health and Education Cess (4%)")).toEqual(["₹3,750", "₹7,500"]);
  expect(await row(page, "Estimated tax")).toEqual(["₹97,500", "₹1,95,000"]);
  await expect(summary(page)).toHaveText(
    "The new regime gives less tax: ₹97,500, which is ₹97,500 less.",
  );
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("is nil on a salary of 12.75 lakh, with marginal relief just above", async ({ page }) => {
  await openTool(page, PATH);
  await field(page, "deductions").fill("0");
  await field(page, "salary").fill("1275000");
  expect(await row(page, "Taxable income")).toEqual(["₹12,00,000", "₹12,25,000"]);
  expect(await row(page, "Rebate (section 156)")).toEqual(["₹60,000", "₹0"]);
  expect((await row(page, "Estimated tax"))[0]).toBe("₹0");
  await field(page, "salary").fill("13,00,000");
  expect(await row(page, "Tax on the slabs")).toEqual(["₹63,750", "₹1,87,500"]);
  expect((await row(page, "Rebate (section 156)"))[0]).toBe("₹38,750");
  expect((await row(page, "Estimated tax"))[0]).toBe("₹26,000");
});

test("applies the surcharge with marginal relief, and 37% only in the old regime", async ({
  page,
}) => {
  await openTool(page, PATH);
  await field(page, "salary").fill("0");
  await field(page, "deductions").fill("0");
  await field(page, "other").fill("50,10,000");
  expect((await row(page, "Surcharge"))[0]).toBe("₹7,000");
  expect((await row(page, "Estimated tax"))[0]).toBe("₹11,33,600");
  await field(page, "other").fill("6,00,00,000");
  expect(await row(page, "Surcharge")).toEqual(["₹43,95,000", "₹65,90,625"]);
  expect(await row(page, "Estimated tax")).toEqual(["₹2,28,54,000", "₹2,53,79,250"]);
});

test("uses the old-regime age slabs and the 12,500 rebate up to 5 lakh", async ({ page }) => {
  await openTool(page, PATH);
  await field(page, "salary").fill("0");
  await field(page, "deductions").fill("0");
  await field(page, "other").fill("10,00,000");
  expect((await row(page, "Tax on the slabs"))[1]).toBe("₹1,12,500");
  await field(page, "age").selectOption("60to79");
  expect((await row(page, "Tax on the slabs"))[1]).toBe("₹1,10,000");
  await field(page, "age").selectOption("80plus");
  expect((await row(page, "Tax on the slabs"))[1]).toBe("₹1,00,000");
  await field(page, "age").selectOption("below60");
  await field(page, "other").fill("5,00,000");
  expect(await row(page, "Rebate (section 156)")).toEqual(["₹5,000", "₹12,500"]);
  await expect(summary(page)).toHaveText("Both regimes give the same estimate: ₹0.");
});

test("refuses amounts that are not whole rupees, and caps income at ₹1,000 crore", async ({
  page,
}) => {
  await openTool(page, PATH);
  await field(page, "salary").fill("12.5");
  await expect(
    page.getByText("Enter the salary in whole rupees, from 0 to ₹10,00,00,00,000."),
  ).toBeVisible();
  await expect(page.locator("#income-tax-table")).toHaveCount(0);
  await field(page, "salary").fill("10000000000");
  await field(page, "other").fill("0");
  await expect(page.locator("#income-tax-table")).toBeVisible();
  await field(page, "other").fill("1");
  await expect(
    page.getByText("Salary and other income together can be at most ₹10,00,00,00,000."),
  ).toBeVisible();
  await field(page, "other").fill("0");
  await field(page, "salary").fill("10000000001");
  await expect(
    page.getByText("Enter the salary in whole rupees, from 0 to ₹10,00,00,00,000."),
  ).toBeVisible();
});

test("shows the tax year, the date checked, the official sources and the estimate note", async ({
  page,
}) => {
  await openTool(page, PATH);
  await expect(field(page, "year")).toHaveText(
    "Tax year 2026-27 (1 April 2026 to 31 March 2027), for a resident individual. Rules checked on 5 October 2026.",
  );
  await expect(page.getByText("An estimate, not tax advice")).toBeVisible();
  const links = field(page, "sources").getByRole("link");
  await expect(links).toHaveCount(4);
  for (const href of await links.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")))) {
    expect(href).toMatch(/^https:\/\/www\.(incometax|incometaxindia|indiabudget)\.gov\.in\//);
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expect(page.locator("#income-tax-table")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
