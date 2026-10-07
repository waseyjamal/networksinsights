import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/developer/subnet-calculator/tool.config";
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

// Subnet Calculator against `wrangler dev` (real CSP and headers): it hydrates with its sample,
// works out textbook subnets as they are typed, including /0, /31 and /32, and refuses an address
// with a leading zero with the reason.

test.use({ baseURL: edgeURL });

const PATH = "/subnet-calculator/";
const box = (page: Page) => page.locator("#subnet-calculator-input");
const value = (page: Page, field: string) =>
  page
    .locator("#subnet-calculator-result tr", {
      has: page.getByRole("rowheader", { name: field, exact: true }),
    })
    .locator("td");

test("works out the sample and a /20 as they are typed", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(value(page, "Network")).toHaveText("192.168.1.0/24");
  await expect(value(page, "Broadcast")).toHaveText("192.168.1.255");
  await expect(value(page, "Usable hosts")).toHaveText("254");

  await box(page).fill("172.16.35.123/20");
  await expect(value(page, "Network")).toHaveText("172.16.32.0/20");
  await expect(value(page, "Subnet mask")).toHaveText("255.255.240.0");
  await expect(value(page, "Wildcard mask")).toHaveText("0.0.15.255");
  await expect(value(page, "Broadcast")).toHaveText("172.16.47.255");
  await expect(value(page, "First usable")).toHaveText("172.16.32.1");
  await expect(value(page, "Last usable")).toHaveText("172.16.47.254");
  await expect(value(page, "Usable hosts")).toHaveText("4,094");
  await box(page).fill("192.168.1.10 255.255.255.192");
  await expect(value(page, "Network")).toHaveText("192.168.1.0/26");
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("/0, /31 and /32", async ({ page }) => {
  await openTool(page, PATH);
  await box(page).fill("8.8.8.8/0");
  await expect(value(page, "Addresses")).toHaveText("4,294,967,296");
  await expect(value(page, "Usable hosts")).toHaveText("4,294,967,294");
  await box(page).fill("10.0.0.1/31");
  await expect(value(page, "Broadcast")).toHaveText("None");
  await expect(value(page, "Usable hosts")).toHaveText("2");
  await expect(page.getByText("both addresses are usable and there is no broadcast")).toBeVisible();
  await box(page).fill("203.0.113.9/32");
  await expect(value(page, "First usable")).toHaveText("203.0.113.9");
  await expect(value(page, "Usable hosts")).toHaveText("1");
});

test("refuses a leading zero and says why", async ({ page }) => {
  await openTool(page, PATH);
  await box(page).fill("010.0.0.1/8");
  await expect(page.getByRole("alert")).toHaveText(
    `"010.0.0.1" has a leading zero. Some systems read 010 as octal (8), others as decimal (10), so the tool refuses it rather than guess.`,
  );
  await expect(page.locator("#subnet-calculator-result")).toHaveCount(0);
  await box(page).fill("10.0.0.1/33");
  await expect(page.getByRole("alert")).toContainText(`"/33" is not a prefix`);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expect(value(page, "Network")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
