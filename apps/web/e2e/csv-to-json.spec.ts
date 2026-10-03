import { expect, test } from "@playwright/test";
import manifest from "../../../tools/developer/csv-to-json/tool.config";
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

// CSV to JSON Parser in the three engines, against `wrangler dev` (real CSP and headers). It renders
// the example of its page without JavaScript, applies each option, detects the delimiter, reads a
// chosen file, downloads the JSON, names the line of a bad row, and its structured data and Quick
// facts match.

test.use({ baseURL: edgeURL });

const PATH = "/csv-to-json/";

test("renders the example of its page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(page.locator('[data-stat="rows"] dd')).toHaveText("2");
  await expect(page.locator('[data-stat="columns"] dd')).toHaveText("3");
  await context.close();
});

test("applies each option, reads a file and downloads", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  const result = page.locator("#c2j-result");
  await expect(result).toHaveValue(/"age": "31"/);

  await page.getByLabel("Convert numbers and true/false").check();
  await page.getByLabel("Pretty print").uncheck();
  await expect(result).toHaveValue(
    '[{"name":"Asha","age":31,"note":"Likes \\"tea\\", and coffee"},{"name":"Ben","age":"","note":true}]',
  );
  await page.getByLabel("First row is the header").uncheck();
  await expect(result).toHaveValue(/^\[\["name","age","note"\]/);

  await page.locator("#c2j-file").setInputFiles({
    name: "data.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("﻿a;b\r\n1;2\r\n3;4\r\n"),
  });
  await expect(page.locator("#c2j-delimiter-hint")).toHaveText("Detected: semicolon");
  await expect(page.locator('[data-stat="rows"] dd')).toHaveText("3");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON" }).click();
  expect((await download).suggestedFilename()).toBe("data.json");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("names the line of a bad row and the length limit", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#c2j-text").fill("a,b\n1,2\n1,2,3");
  await expect(page.locator("#c2j-error")).toContainText(
    "Line 3: this row has 3 fields, but the first row has 2.",
  );
  await expect(page.getByRole("button", { name: "Download JSON" })).toBeDisabled();
  await page.locator("#c2j-text").fill(`a\n${"x".repeat(999_999)}`);
  await expect(page.locator("#c2j-error")).toContainText("the limit is 1,000,000");
  await page.locator("#c2j-text").fill(`a\n${"x".repeat(999_998)}`);
  await expect(page.locator('[data-stat="rows"] dd')).toHaveText("1");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await page.locator("#c2j-text").fill('a\n"open');
    await expect(page.locator("#c2j-error")).toBeVisible();
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
