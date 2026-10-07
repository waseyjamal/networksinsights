import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/developer/cidr-range-converter/tool.config";
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

// CIDR to IP Range Converter against `wrangler dev` (real CSP and headers): an unaligned IPv4 range
// becomes the blocks the page example lists, IPv4 and IPv6 blocks become their ranges, and a mixed
// range is refused.

test.use({ baseURL: edgeURL });

const PATH = "/cidr-range-converter/";
const box = (page: Page) => page.locator("#cidr-range-converter-input");
const blocks = (page: Page) => page.locator("#cidr-range-converter-blocks");
const value = (page: Page, field: string) =>
  page
    .locator("#cidr-range-converter-result tr", {
      has: page.getByRole("rowheader", { name: field, exact: true }),
    })
    .locator("td");

test("turns the sample range into the five blocks of the page example", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(blocks(page)).toHaveValue(
    "192.168.0.5/32\n192.168.0.6/31\n192.168.0.8/29\n192.168.0.16/30\n192.168.0.20/32",
  );
  await expect(page.locator("#cidr-range-converter-summary")).toHaveText(
    "16 addresses from 192.168.0.5 to 192.168.0.20, in 5 blocks.",
  );
  await box(page).fill("2001:db8::1 - 2001:db8::ff");
  await expect(blocks(page)).toHaveValue(
    [
      "2001:db8::1/128",
      "2001:db8::2/127",
      "2001:db8::4/126",
      "2001:db8::8/125",
      "2001:db8::10/124",
      "2001:db8::20/123",
      "2001:db8::40/122",
      "2001:db8::80/121",
    ].join("\n"),
  );
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("turns IPv4 and IPv6 blocks into ranges", async ({ page }) => {
  await openTool(page, PATH);
  await box(page).fill("10.0.0.0/22");
  await expect(value(page, "First address")).toHaveText("10.0.0.0");
  await expect(value(page, "Last address")).toHaveText("10.0.3.255");
  await expect(value(page, "Addresses")).toHaveText("1,024");
  await expect(value(page, "Subnet mask")).toHaveText("255.255.252.0");
  await box(page).fill("2001:db8::/32");
  await expect(value(page, "Last address")).toHaveText("2001:db8:ffff:ffff:ffff:ffff:ffff:ffff");
  await expect(value(page, "Addresses")).toHaveText("79,228,162,514,264,337,593,543,950,336");
  await box(page).fill("fe80::1:2/64");
  await expect(
    page.getByText("fe80::1:2 is inside the block fe80::/64, shown below."),
  ).toBeVisible();
});

test("refuses a range that mixes IPv4 and IPv6", async ({ page }) => {
  await openTool(page, PATH);
  await box(page).fill("10.0.0.0 - ::1");
  await expect(page.getByRole("alert")).toHaveText(
    "The start and end must both be IPv4 or both be IPv6.",
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expect(blocks(page)).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
