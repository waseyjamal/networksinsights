import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/calculators/percentage-calculator/tool.config";
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

// Percentage Calculator in the three engines, against `wrangler dev` (real CSP and headers). It
// renders its first example without JavaScript, answers each of its four questions with the
// examples of its page, explains empty and unreadable boxes and a zero divisor, and its structured
// data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/percentage-calculator/";
const result = (page: Page) => page.locator('[data-stat="result"] dd');
const first = (page: Page) => page.locator("#pc-a");
const second = (page: Page) => page.locator("#pc-b");

test("renders its first example without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(result(page)).toHaveText("12");
  await expect(page.locator("#pc-sentence")).toHaveText("15% of 80 is 12.");
  await context.close();
});

test("answers the four questions with the examples of its page", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);

  await expect(result(page)).toHaveText("12");
  await expect(page.getByText("Worked as:")).toContainText("15 × 80 ÷ 100");

  await page.getByLabel("What do you want to know?").selectOption("whatPercent");
  await first(page).fill("20");
  await second(page).fill("80");
  await expect(result(page)).toHaveText("25%");

  await page.getByLabel("What do you want to know?").selectOption("change");
  await first(page).fill("50");
  await second(page).fill("75");
  await expect(result(page)).toHaveText("50%");
  await expect(page.locator("#pc-sentence")).toHaveText("From 50 to 75 is an increase of 50%.");
  await expect(page.locator('[data-stat="extra-0"] dd')).toHaveText("25");
  await second(page).fill("60");
  await first(page).fill("80");
  await expect(page.locator("#pc-sentence")).toHaveText("From 80 to 60 is a decrease of 25%.");

  await page.getByLabel("What do you want to know?").selectOption("addSub");
  await first(page).fill("20");
  await second(page).fill("50");
  await expect(result(page)).toHaveText("60");
  await page.getByLabel("Add or subtract?").selectOption("subtract");
  await expect(result(page)).toHaveText("40");
  await expect(page.locator("#pc-sentence")).toHaveText("Subtracting 20% from 50 gives 40.");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("explains an empty box, a bad number and a zero divisor", async ({ page }) => {
  await openTool(page, PATH);
  await first(page).fill("");
  await expect(page.locator("#pc-a-error")).toHaveText("Enter a number for Percent (X).");
  await expect(first(page)).toHaveAttribute("aria-invalid", "true");
  await expect(result(page)).toHaveCount(0);

  await first(page).fill("abc");
  await expect(page.locator("#pc-a-error")).toContainText("is not a number");

  await page.getByLabel("What do you want to know?").selectOption("whatPercent");
  await first(page).fill("5");
  await second(page).fill("0");
  await expect(page.locator("#pc-b-error")).toHaveText(
    "The total (Y) cannot be 0: no number is a percent of 0.",
  );

  await page.getByLabel("What do you want to know?").selectOption("change");
  await first(page).fill("0");
  await second(page).fill("10");
  await expect(page.locator("#pc-a-error")).toContainText("cannot be 0");

  await first(page).fill("1e5");
  await expect(page.locator("#pc-a-error")).toContainText("is not a number");
  await first(page).fill("2000000000000000");
  await expect(page.locator("#pc-a-error")).toContainText("too large");
  await first(page).fill("1,234.5");
  await expect(page.locator("#pc-a-error")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await first(page).fill("");
    await expect(page.locator("#pc-a-error")).toBeVisible();
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
