import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/date-time/unix-timestamp-converter/tool.config";
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

// Unix Timestamp Converter in the three engines, against `wrangler dev` (real CSP and headers). It
// renders the example of its page without JavaScript, detects seconds and milliseconds, shows the
// device time zone, converts a date back, refuses one past its range, and its structured data and
// Quick facts match. The browser runs in the India time zone, so the local time is known.

test.use({ baseURL: edgeURL, timezoneId: "Asia/Kolkata" });

const PATH = "/unix-timestamp-converter/";
const cell = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);

test("renders the example of its page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(cell(page, "utc")).toHaveText("2023-11-14 22:13:20.000 UTC");
  await expect(cell(page, "seconds")).toHaveText("1700000000");
  await context.close();
});

test("converts both ways in the device time zone", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(cell(page, "unit")).toHaveText("seconds");
  await expect(cell(page, "local")).toHaveText("2023-11-15 03:43:20.000 UTC+05:30");
  await expect(cell(page, "iso")).toHaveText("2023-11-14T22:13:20.000Z");

  await page.locator("#ts-value").fill("1700000000000");
  await expect(cell(page, "unit")).toHaveText("milliseconds");
  await expect(cell(page, "utc")).toHaveText("2023-11-14 22:13:20.000 UTC");

  await page.locator("#ts-zone").selectOption("local");
  await page.locator("#ts-date").fill("2023-11-15 03:43:20");
  await expect(cell(page, "seconds")).toHaveText("1700000000");
  await expect(cell(page, "milliseconds")).toHaveText("1700000000000");

  await page.getByRole("button", { name: "Use the current time" }).click();
  await expect(cell(page, "unit")).toHaveText("seconds");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("accepts the ends of its range and refuses one past them", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#ts-value").fill("253402300799999");
  await expect(cell(page, "iso")).toHaveText("9999-12-31T23:59:59.999Z");
  await page.locator("#ts-value").fill("253402300800000");
  await expect(page.locator("#ts-value-error")).toContainText("outside the supported range");
  await page.locator("#ts-value").fill("-62135596800000");
  await expect(cell(page, "iso")).toHaveText("0001-01-01T00:00:00.000Z");
  await page.locator("#ts-date").fill("2023-02-29");
  await expect(page.locator("#ts-date-error")).toContainText("does not exist");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await page.locator("#ts-value").fill("abc");
    await expect(page.locator("#ts-value-error")).toBeVisible();
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
