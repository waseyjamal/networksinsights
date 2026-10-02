import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/color-design/contrast-checker/tool.config";
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

// Contrast Checker in the three engines, against `wrangler dev` (real CSP and headers). It renders
// the example of its page without JavaScript, gives the ratios and verdicts the page quotes, follows
// the pickers, swaps the colors, rounds the shown ratio down while deciding on the exact one,
// explains unreadable codes, and its structured data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/contrast-checker/";
const foreground = (page: Page) => page.locator("#cc-foreground");
const background = (page: Page) => page.locator("#cc-background");
const ratio = (page: Page) => page.locator('[data-stat="ratio"] dd');
const verdicts = async (page: Page) =>
  (await page.locator("#cc-results tbody tr").allInnerTexts()).map((row) => row.split("\t"));

const EXAMPLE = [
  ["Normal text, AA", "4.5:1", "Pass"],
  ["Large text, AA", "3:1", "Pass"],
  ["Normal text, AAA", "7:1", "Fail"],
  ["Large text, AAA", "4.5:1", "Pass"],
  ["UI components and graphics, AA", "3:1", "Pass"],
];

test("renders the example of its page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(ratio(page)).toHaveText("4.54:1");
  expect(await verdicts(page)).toEqual(EXAMPLE);
  await context.close();
});

test("gives the ratios and verdicts the page quotes", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(ratio(page)).toHaveText("4.54:1");
  expect(await verdicts(page)).toEqual(EXAMPLE);
  await expect(page.locator("#cc-preview")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator("#cc-preview")).toHaveCSS("color", "rgb(118, 118, 118)");

  await foreground(page).fill("#777777");
  await expect(ratio(page)).toHaveText("4.47:1");
  expect((await verdicts(page))[0]).toEqual(["Normal text, AA", "4.5:1", "Fail"]);

  await foreground(page).fill("000");
  await expect(ratio(page)).toHaveText("21.00:1");
  expect((await verdicts(page)).every((row) => row[2] === "Pass")).toBe(true);

  await foreground(page).fill("#fff");
  await expect(ratio(page)).toHaveText("1.00:1");
  expect((await verdicts(page)).every((row) => row[2] === "Fail")).toBe(true);

  await foreground(page).fill("#959595");
  await expect(ratio(page)).toHaveText("2.99:1");
  expect((await verdicts(page))[4]).toEqual(["UI components and graphics, AA", "3:1", "Fail"]);
  await foreground(page).fill("#949494");
  await expect(ratio(page)).toHaveText("3.03:1");
  expect((await verdicts(page))[4]).toEqual(["UI components and graphics, AA", "3:1", "Pass"]);

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("follows the pickers and swaps the colors", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#cc-foreground-picker").fill("#000000");
  await expect(foreground(page)).toHaveValue("#000000");
  await expect(ratio(page)).toHaveText("21.00:1");
  await page.locator("#cc-background-picker").fill("#ffff00");
  await expect(background(page)).toHaveValue("#ffff00");
  await expect(ratio(page)).toHaveText("19.55:1");

  await page.getByRole("button", { name: "Swap colors" }).click();
  await expect(foreground(page)).toHaveValue("#ffff00");
  await expect(background(page)).toHaveValue("#000000");
  await expect(ratio(page)).toHaveText("19.55:1");
});

test("explains codes that cannot be read, including transparency", async ({ page }) => {
  await openTool(page, PATH);
  await foreground(page).fill("");
  await expect(page.locator("#cc-foreground-error")).toHaveText(
    "Enter the text color as a HEX code, such as #767676.",
  );
  await expect(foreground(page)).toHaveAttribute("aria-invalid", "true");
  await expect(ratio(page)).toHaveCount(0);
  await foreground(page).fill("#12345");
  await expect(page.locator("#cc-foreground-error")).toHaveText(
    "The text color needs 3 or 6 digits after the #, such as #767676; this has 5.",
  );
  await foreground(page).fill("#fff8");
  await expect(page.locator("#cc-foreground-error")).toContainText("transparency");
  await foreground(page).fill("#767676");
  await expect(page.locator("#cc-foreground-error")).toHaveCount(0);
  await background(page).fill("white");
  await expect(page.locator("#cc-background-error")).toContainText("only the digits 0 to 9");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await background(page).fill("#12345");
    await expect(page.locator("#cc-background-error")).toBeVisible();
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
