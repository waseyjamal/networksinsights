import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/date-time/age-calculator/tool.config";
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

// Age Calculator in the three engines, against `wrangler dev` (real CSP and headers). It asks for a
// birth date without JavaScript, fills "Age on" with the device's local date, answers the examples
// of its page, handles 29 February, explains a future birth date and a missing date, and its
// structured data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/age-calculator/";
const birth = (page: Page) => page.locator("#age-birth");
const on = (page: Page) => page.locator("#age-on");
const cell = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);

test("asks for a date of birth without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(page.locator("#age-message")).toHaveText("Choose a date of birth to see an age.");
  await context.close();
});

test("fills Age on with the local date of the device", async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 2, 23, 30) });
  await openTool(page, PATH);
  await expect(on(page)).toHaveValue("2026-10-02");
  await birth(page).fill("1990-05-15");
  await expect(cell(page, "years")).toHaveText("36");
});

test("answers the examples of its page", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);

  await birth(page).fill("1990-05-15");
  await on(page).fill("2026-10-02");
  await expect(cell(page, "years")).toHaveText("36");
  await expect(cell(page, "months")).toHaveText("4");
  await expect(cell(page, "days")).toHaveText("17");
  await expect(cell(page, "total-days")).toHaveText("13,289");
  await expect(page.locator("#age-next")).toHaveText(
    "Next birthday: Saturday, 15 May 2027, in 225 days, turning 37.",
  );

  await birth(page).fill("2000-02-29");
  await on(page).fill("2001-02-28");
  await expect(cell(page, "years")).toHaveText("1");
  await expect(cell(page, "months")).toHaveText("0");
  await expect(cell(page, "days")).toHaveText("0");
  await expect(page.locator("#age-next")).toContainText("The birthday is on this very date");
  await on(page).fill("2026-10-02");
  await expect(page.locator("#age-next")).toHaveText(
    "Next birthday: Sunday, 28 February 2027, in 149 days, turning 27.",
  );

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("explains a future birth date and a missing date", async ({ page }) => {
  await openTool(page, PATH);
  await on(page).fill("2026-10-02");
  await birth(page).fill("2030-01-01");
  await expect(page.locator("#age-birth-error")).toHaveText(
    "The birth date (1 January 2030) is after the age-on date (2 October 2026), so there is no age to show yet.",
  );
  await expect(birth(page)).toHaveAttribute("aria-invalid", "true");
  await expect(cell(page, "years")).toHaveCount(0);

  await birth(page).fill("1990-05-15");
  await expect(page.locator("#age-birth-error")).toHaveCount(0);
  await on(page).fill("");
  await expect(page.locator("#age-on-error")).toHaveText("Choose the age-on date.");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await birth(page).fill("1990-05-15");
    await expectNoAxeViolations(page);
    await birth(page).fill("2999-01-01");
    await expect(page.locator("#age-birth-error")).toBeVisible();
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
