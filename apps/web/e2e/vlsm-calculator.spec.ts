import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/developer/vlsm-calculator/tool.config";
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

// VLSM Calculator against `wrangler dev` (real CSP and headers): the sample plan is the page
// example, a new list is planned as it is typed, and a subnet that does not fit is named.

test.use({ baseURL: edgeURL });

const PATH = "/vlsm-calculator/";
const rows = (page: Page) => page.locator("#vlsm-calculator-result tbody tr");

const EXAMPLE = [
  [
    "Engineering",
    "100",
    "126",
    "192.168.1.0/25",
    "255.255.255.128",
    "192.168.1.1 – 192.168.1.126",
    "192.168.1.127",
  ],
  [
    "Office",
    "50",
    "62",
    "192.168.1.128/26",
    "255.255.255.192",
    "192.168.1.129 – 192.168.1.190",
    "192.168.1.191",
  ],
  [
    "Sales",
    "20",
    "30",
    "192.168.1.192/27",
    "255.255.255.224",
    "192.168.1.193 – 192.168.1.222",
    "192.168.1.223",
  ],
  [
    "Link",
    "2",
    "2",
    "192.168.1.224/30",
    "255.255.255.252",
    "192.168.1.225 – 192.168.1.226",
    "192.168.1.227",
  ],
];

test("plans the page example, largest first", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(rows(page)).toHaveCount(4);
  for (const [index, cells] of EXAMPLE.entries()) {
    await expect(rows(page).nth(index).locator("th, td")).toHaveText(cells);
  }
  await expect(page.locator("#vlsm-calculator-free")).toHaveText(
    "28 addresses of 192.168.1.0/24 are still free, from 192.168.1.228.",
  );
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("plans a /16 and names a subnet that does not fit", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#vlsm-calculator-network").fill("172.16.0.0/16");
  await page.locator("#vlsm-calculator-needs").fill("250\n1000\n500");
  await expect(rows(page).nth(0).locator("td").nth(2)).toHaveText("172.16.0.0/22");
  await expect(rows(page).nth(1).locator("td").nth(2)).toHaveText("172.16.4.0/23");
  await expect(rows(page).nth(2).locator("td").nth(2)).toHaveText("172.16.6.0/24");
  await page.locator("#vlsm-calculator-network").fill("10.0.0.0/30");
  await page.locator("#vlsm-calculator-needs").fill("Too big 3");
  await expect(page.getByRole("alert")).toHaveText(
    "Too big does not fit: 10.0.0.0/30 has no room left for it. Use a larger network or fewer hosts.",
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expect(rows(page)).toHaveCount(4);
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
