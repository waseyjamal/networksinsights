import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/calculators/gst-calculator/tool.config";
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

// GST Calculator in the three engines, against `wrangler dev` (real CSP and headers). It renders the
// example of its page without JavaScript, adds and removes GST, takes a quick rate or a typed one,
// refuses inputs past its limits, and its structured data and Quick facts match.

test.use({ baseURL: edgeURL });

const PATH = "/gst-calculator/";
const cell = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);

async function expectFigures(page: Page, figures: string[]) {
  for (const [index, id] of ["base", "gst", "cgst", "sgst", "total"].entries()) {
    await expect(cell(page, id)).toHaveText(figures[index] ?? "");
  }
}

test("renders the example of its page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expectFigures(page, ["10,000.00", "1,800.00", "900.00", "900.00", "11,800.00"]);
  await context.close();
});

test("adds and removes GST at a quick or typed rate", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);

  await page.getByRole("button", { name: "Remove GST" }).click();
  await page.locator("#gst-amount").fill("11,800");
  await expectFigures(page, ["10,000.00", "1,800.00", "900.00", "900.00", "11,800.00"]);

  await page.getByRole("button", { name: "Add GST" }).click();
  await page.locator("#gst-amount").fill("1000");
  await page.getByRole("button", { name: "40%" }).click();
  await expect(page.locator("#gst-rate")).toHaveValue("40");
  await expect(cell(page, "total")).toHaveText("1,400.00");
  await page.getByRole("button", { name: "5%" }).click();
  await expect(cell(page, "total")).toHaveText("1,050.00");
  await page.locator("#gst-rate").fill("0.25");
  await expect(cell(page, "gst")).toHaveText("2.50");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("refuses inputs past its limits", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#gst-amount").fill("1000000000000.01");
  await expect(page.locator("#gst-amount-error")).toContainText("the limit is 1,000,000,000,000");
  await page.locator("#gst-amount").fill("1000000000000");
  await expect(page.locator("#gst-amount-error")).toHaveCount(0);
  await page.locator("#gst-rate").fill("100.01");
  await expect(page.locator("#gst-rate-error")).toContainText("from 0 to 100 percent");
  await page.locator("#gst-rate").fill("100");
  await expect(cell(page, "total")).toHaveText("2,000,000,000,000.00");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await page.locator("#gst-rate").fill("");
    await expect(page.locator("#gst-rate-error")).toBeVisible();
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
