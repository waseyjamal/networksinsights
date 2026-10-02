import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/date-time/date-difference-calculator/tool.config";
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

// Date Difference Calculator in the three engines, against `wrangler dev` (real CSP and headers).
// It renders the example of its page without JavaScript, answers that example with and without the
// end date, puts dates in order, handles a leap day and a month end, explains a missing date, and
// its structured data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/date-difference-calculator/";
const cell = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);
const start = (page: Page) => page.locator("#dd-start");
const end = (page: Page) => page.locator("#dd-end");

async function expectCells(page: Page, values: Record<string, string>) {
  for (const [id, value] of Object.entries(values)) await expect(cell(page, id)).toHaveText(value);
}

test("renders the example of its page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expectCells(page, {
    years: "0",
    months: "2",
    days: "15",
    "total-days": "74",
    weeks: "10 weeks and 4 days",
    weekdays: "54",
  });
  await context.close();
});

test("answers the example with and without the end date", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);

  await page.getByLabel("Include the end date in the count").check();
  await expectCells(page, {
    months: "2",
    days: "16",
    "total-days": "75",
    weeks: "10 weeks and 5 days",
    weekdays: "55",
  });
  await page.getByLabel("Include the end date in the count").uncheck();
  await expectCells(page, { days: "15", "total-days": "74", weekdays: "54" });

  await start(page).fill("2020-02-29");
  await end(page).fill("2024-02-29");
  await expectCells(page, { years: "4", months: "0", days: "0", "total-days": "1,461" });

  await start(page).fill("2026-01-31");
  await end(page).fill("2026-03-01");
  await expectCells(page, { months: "1", days: "1", "total-days": "29" });

  await start(page).fill("2026-05-05");
  await end(page).fill("2026-05-05");
  await expectCells(page, { "total-days": "0", weeks: "0 weeks and 0 days", weekdays: "0" });
  await page.getByLabel("Include the end date in the count").check();
  await expectCells(page, { "total-days": "1", weekdays: "1" });

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("puts the dates in order when the end is earlier, and says so", async ({ page }) => {
  await openTool(page, PATH);
  await expect(page.locator("#dd-swapped")).toHaveCount(0);
  await start(page).fill("2026-03-20");
  await end(page).fill("2026-01-05");
  await expect(page.locator("#dd-swapped")).toHaveText(
    "The end date is before the start date, so the two dates were put in order.",
  );
  await expectCells(page, { months: "2", days: "15", "total-days": "74" });
});

test("explains a missing date and a date that is not real", async ({ page }) => {
  await openTool(page, PATH);
  await start(page).fill("");
  await expect(page.locator("#dd-start-error")).toHaveText("Choose the start date.");
  await expect(start(page)).toHaveAttribute("aria-invalid", "true");
  await expect(cell(page, "total-days")).toHaveCount(0);
  await start(page).fill("2026-01-05");
  await expect(page.locator("#dd-start-error")).toHaveCount(0);
  await end(page).fill("");
  await expect(page.locator("#dd-end-error")).toHaveText("Choose the end date.");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await start(page).fill("2026-04-01");
    await end(page).fill("2026-03-01");
    await expect(page.locator("#dd-swapped")).toBeVisible();
    await expectNoAxeViolations(page);
    await end(page).fill("");
    await expect(page.locator("#dd-end-error")).toBeVisible();
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
