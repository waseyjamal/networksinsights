import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/date-time/time-zone-converter/tool.config";
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

// Time Zone Converter in the three engines, against `wrangler dev` (real CSP and headers). It
// renders the example of its page without JavaScript, converts it, follows daylight saving, applies
// the two rules for times that do not exist and times that happen twice, adds and removes zones up
// to the limit, falls back to its fixed list when the browser has no zone list, and its structured
// data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/time-zone-converter/";
const rows = (page: Page) => page.locator("#tz-results tbody tr");
const rowTexts = async (page: Page) =>
  (await rows(page).allInnerTexts()).map((text) => text.split("\t"));
const date = (page: Page) => page.locator("#tz-date");
const time = (page: Page) => page.locator("#tz-time");
const source = (page: Page) => page.locator("#tz-source");

async function expectExample(page: Page) {
  await expect(page.locator('[data-stat="utc"] dd')).toHaveText("2026-07-15 13:00 UTC");
  expect(await rowTexts(page)).toEqual([
    ["America/New_York (from)", "Wed, 15 Jul 2026", "09:00", "UTC-04:00"],
    ["Europe/London", "Wed, 15 Jul 2026", "14:00", "UTC+01:00"],
    ["Asia/Kolkata", "Wed, 15 Jul 2026", "18:30", "UTC+05:30"],
    ["Asia/Tokyo", "Wed, 15 Jul 2026", "22:00", "UTC+09:00"],
  ]);
}

test("renders the example of its page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expectExample(page);
  await context.close();
});

test("converts, follows daylight saving and shows a day shift", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expectExample(page);

  await date(page).fill("2026-01-15");
  await expect(page.locator('[data-stat="utc"] dd')).toHaveText("2026-01-15 14:00 UTC");
  expect((await rowTexts(page))[1]).toEqual([
    "Europe/London",
    "Thu, 15 Jan 2026",
    "14:00",
    "UTC+00:00",
  ]);

  await date(page).fill("2026-07-15");
  await time(page).fill("23:00");
  expect((await rowTexts(page))[3]).toEqual([
    "Asia/Tokyo",
    "Thu, 16 Jul 2026 (+1 day)",
    "12:00",
    "UTC+09:00",
  ]);

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("moves a time that does not exist forward and says so", async ({ page }) => {
  await openTool(page, PATH);
  await date(page).fill("2026-03-08");
  await time(page).fill("02:30");
  await expect(page.locator("#tz-notice")).toHaveText(
    "02:30 does not exist in America/New_York on Sun, 8 Mar 2026, because the clocks skip forward. It is moved forward by the length of the skip, to 03:30.",
  );
  await expect(page.locator("#tz-notice")).toHaveAttribute("data-kind", "gap");
  await expect(page.locator('[data-stat="utc"] dd')).toHaveText("2026-03-08 07:30 UTC");
  expect((await rowTexts(page))[0]).toEqual([
    "America/New_York (from)",
    "Sun, 8 Mar 2026",
    "03:30",
    "UTC-04:00",
  ]);
});

test("uses the first of a time that happens twice and names the second", async ({ page }) => {
  await openTool(page, PATH);
  await date(page).fill("2026-11-01");
  await time(page).fill("01:30");
  await expect(page.locator("#tz-notice")).toHaveText(
    "01:30 happens twice in America/New_York on Sun, 1 Nov 2026, because the clocks go back. The first time, at UTC-04:00, is used; the second is at UTC-05:00.",
  );
  await expect(page.locator("#tz-notice")).toHaveAttribute("data-kind", "overlap");
  await expect(page.locator('[data-stat="utc"] dd')).toHaveText("2026-11-01 05:30 UTC");
  await time(page).fill("02:00");
  await expect(page.locator("#tz-notice")).toHaveCount(0);
});

// Every click that changes the layout costs a WebKit run a long frame, so the zone list is
// tested in three short tests rather than one long walk that would outlast the test timeout.
test("adds a zone and removes a zone", async ({ page }) => {
  await openTool(page, PATH);
  await expect(page.locator("#tz-targets li")).toHaveCount(3);
  await page.getByRole("button", { name: "Remove Asia/Tokyo" }).click();
  await expect(rows(page)).toHaveCount(3);

  await page.locator("#tz-add").selectOption("Pacific/Honolulu");
  await page.getByRole("button", { name: "Add zone" }).click();
  await expect(rows(page)).toHaveCount(4);
  expect((await rowTexts(page))[3]).toEqual([
    "Pacific/Honolulu",
    "Wed, 15 Jul 2026",
    "03:00",
    "UTC-10:00",
  ]);
  await expect(page.locator("#tz-add")).toBeEnabled();
});

test("stops at ten zones and frees a place when one is removed", async ({ page }) => {
  await openTool(page, PATH);
  for (const zone of [
    "UTC",
    "Asia/Dubai",
    "Europe/Paris",
    "Europe/Berlin",
    "Africa/Cairo",
    "Asia/Seoul",
    "Europe/Rome",
  ]) {
    await page.locator("#tz-add").selectOption(zone);
    await page.getByRole("button", { name: "Add zone" }).click();
  }
  await expect(page.locator("#tz-targets li")).toHaveCount(10);
  await expect(page.locator("#tz-add")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add zone" })).toBeDisabled();
  await page.getByRole("button", { name: "Remove UTC" }).click();
  await expect(page.locator("#tz-targets li")).toHaveCount(9);
  await expect(page.locator("#tz-add")).toBeEnabled();
});

test("asks for at least one zone when the last one is removed", async ({ page }) => {
  await openTool(page, PATH);
  for (const zone of ["Europe/London", "Asia/Kolkata", "Asia/Tokyo"]) {
    await page.getByRole("button", { name: `Remove ${zone}` }).click();
  }
  await expect(page.locator("#tz-targets li")).toHaveCount(0);
  await expect(page.locator("#tz-targets-error")).toHaveText(
    "Add at least one zone to convert to.",
  );
});

test("explains a missing date or time", async ({ page }) => {
  await openTool(page, PATH);
  await date(page).fill("");
  await expect(page.locator("#tz-date-error")).toHaveText("Choose a date.");
  await date(page).fill("2026-07-15");
  await time(page).fill("");
  await expect(page.locator("#tz-time-error")).toHaveText("Choose a time.");
});

test("offers the browser's own zone list, or a fixed list of 43 when there is none", async ({
  page,
}) => {
  await openTool(page, PATH);
  const own = await page.evaluate(() => Intl.supportedValuesOf("timeZone").length);
  expect(await source(page).locator("option").count()).toBeGreaterThanOrEqual(own);
  await expect(page.getByText("This browser cannot list every time zone")).toHaveCount(0);
});

test("uses the fixed list when the browser cannot list zones", async ({ page }) => {
  await page.addInitScript(() => {
    (Intl as unknown as { supportedValuesOf?: unknown }).supportedValuesOf = undefined;
  });
  await openTool(page, PATH);
  await expect(
    page.getByText(
      "This browser cannot list every time zone, so a fixed list of 43 zones is offered.",
    ),
  ).toBeVisible();
  await expect(source(page).locator("option")).toHaveCount(43);
  await expectExample(page);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await date(page).fill("2026-03-08");
    await time(page).fill("02:30");
    await expect(page.locator("#tz-notice")).toBeVisible();
    await expectNoAxeViolations(page);
    await date(page).fill("");
    await expect(page.locator("#tz-date-error")).toBeVisible();
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
