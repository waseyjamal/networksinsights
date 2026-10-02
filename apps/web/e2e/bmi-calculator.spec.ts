import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/calculators/bmi-calculator/tool.config";
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

// BMI Calculator in the three engines, against `wrangler dev` (real CSP and headers). It renders
// the example of its page without JavaScript, switches between metric and imperial, shows the WHO
// category at each cut-off, states its adult-only notice, explains refused input, and its
// structured data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/bmi-calculator/";
const cell = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);

test("renders the example of its page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(cell(page, "bmi")).toHaveText("22.9");
  await expect(cell(page, "category")).toHaveText("Normal weight");
  await expect(cell(page, "range")).toHaveText("56.7 to 76.3");
  await expect(page.getByText("Adults only. Not medical advice.")).toBeVisible();
  await expect(
    page.getByText("BMI ignores muscle and body build, so it can mislead"),
  ).toBeVisible();
  await context.close();
});

test("switches to imperial and classifies every band", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);

  await page.getByLabel("Units").selectOption("imperial");
  await expect(cell(page, "bmi")).toHaveText("22.7");
  await expect(cell(page, "category")).toHaveText("Normal weight");
  await expect(cell(page, "range")).toHaveText("125.3 to 168.6");
  await expect(page.getByText("Normal range at this height (lb)")).toBeVisible();
  await page.locator("#bmi-inches").fill("");
  await page.locator("#bmi-feet").fill("6");
  await page.locator("#bmi-weight").fill("180");
  await expect(cell(page, "bmi")).toHaveText("24.4");

  await page.getByLabel("Units").selectOption("metric");
  await page.locator("#bmi-cm").fill("170");
  for (const [kg, bmi, category] of [
    ["50", "17.3", "Underweight"],
    ["70", "24.2", "Normal weight"],
    ["80", "27.7", "Overweight (pre-obesity)"],
    ["95", "32.9", "Obesity"],
  ] as const) {
    await page.locator("#bmi-weight").fill(kg);
    await expect(cell(page, "bmi")).toHaveText(bmi);
    await expect(cell(page, "category")).toHaveText(category);
  }
  await page.locator("#bmi-cm").fill("100");
  await page.locator("#bmi-weight").fill("24.96");
  await expect(cell(page, "bmi")).toHaveText("25.0");
  await expect(cell(page, "category")).toHaveText("Overweight (pre-obesity)");
  await page.locator("#bmi-weight").fill("24.94");
  await expect(cell(page, "category")).toHaveText("Normal weight");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("explains empty, unreadable and out-of-range boxes", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#bmi-cm").fill("");
  await expect(page.locator("#bmi-cm-error")).toHaveText("Enter the height.");
  await expect(cell(page, "bmi")).toHaveCount(0);
  await page.locator("#bmi-cm").fill("49");
  await expect(page.locator("#bmi-cm-error")).toContainText("from 50 to 300 centimetres");
  await page.locator("#bmi-cm").fill("175");
  await page.locator("#bmi-weight").fill("9");
  await expect(page.locator("#bmi-weight-error")).toContainText("from 10 to 650 kilograms");
  await page.locator("#bmi-weight").fill("abc");
  await expect(page.locator("#bmi-weight-error")).toContainText("is not a number");

  await page.getByLabel("Units").selectOption("imperial");
  await page.locator("#bmi-inches").fill("12");
  await expect(page.locator("#bmi-inches-error")).toContainText(
    "from 0 up to, but not including, 12",
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await page.locator("#bmi-cm").fill("");
    await expect(page.locator("#bmi-cm-error")).toBeVisible();
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
