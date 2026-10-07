import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/developer/ipv6-expander-compressor/tool.config";
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

// IPv6 Address Expander and Compressor against `wrangler dev` (real CSP and headers): the sample
// is the page example (a tie between two zero runs), and several lines are expanded and compressed
// at once, with a bad line explained and the others still answered.

test.use({ baseURL: edgeURL });

const PATH = "/ipv6-expander-compressor/";
const rows = (page: Page) => page.locator("#ipv6-expander-compressor-result tbody tr");

test("compresses the page example to the leftmost run", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(rows(page).first().locator("th, td")).toHaveText([
    "2001:0DB8:0000:0000:0001:0000:0000:0001",
    "2001:0db8:0000:0000:0001:0000:0000:0001",
    "2001:db8::1:0:0:1",
  ]);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("answers every line, with :: at the start, middle and end", async ({ page }) => {
  await openTool(page, PATH);
  await page
    .locator("#ipv6-expander-compressor-input")
    .fill(
      "::1\nfe80:0:0:0:0:0:0:1\n2001:db8::\n2001:db8:0:1:1:1:1:1\n1::2::3\n0:0:0:0:0:ffff:c000:280",
    );
  await expect(rows(page)).toHaveCount(6);
  await expect(rows(page).locator("td:last-child")).toHaveText([
    "::1",
    "fe80::1",
    "2001:db8::",
    "2001:db8:0:1:1:1:1:1",
    "",
    "::ffff:192.0.2.128",
  ]);
  await expect(rows(page).nth(4).locator("td").first()).toHaveText(
    `Uses "::" twice; it may appear only once.`,
  );
  await expect(rows(page).nth(0).locator("td").first()).toHaveText(
    "0000:0000:0000:0000:0000:0000:0000:0001",
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expect(rows(page)).toHaveCount(1);
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
