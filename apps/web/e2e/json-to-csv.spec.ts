import { expect, test } from "@playwright/test";
import manifest from "../../../tools/developer/json-to-csv/tool.config";
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

// JSON to CSV Converter in the three engines, against `wrangler dev` (real CSP and headers). It
// renders the example of its page without JavaScript, applies each option, reads a chosen file,
// downloads the CSV, explains bad JSON, and its structured data and Quick facts match.

test.use({ baseURL: edgeURL });

const PATH = "/json-to-csv/";
const EXAMPLE_CSV =
  'name,city,tags,address.zip,note\nAsha,Pune,"[""a"",""b""]",411001,\n"Ben, Jr.",,,, =1+1\n';

test("renders the example of its page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(page.locator('[data-stat="rows"] dd')).toHaveText("2");
  await expect(page.locator('[data-stat="columns"] dd')).toHaveText("5");
  await context.close();
});

test("applies each option, reads a file and downloads", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  const result = page.locator("#j2c-result");
  // A textarea normalises CRLF to LF in its value.
  await expect(result).toHaveValue(EXAMPLE_CSV);

  await page.getByLabel("Protect against spreadsheet formulas").uncheck();
  await expect(result).toHaveValue(/,,,,=1\+1\n$/);
  await page.getByLabel("Flatten nested objects (a.b)").uncheck();
  await expect(result).toHaveValue(/^name,city,tags,address,note\n/);
  await page.getByLabel("Header row").uncheck();
  await expect(result).toHaveValue(/^Asha,/);
  await page.locator("#j2c-delimiter").selectOption("semicolon");
  await page.getByLabel("Quote every field").check();
  await expect(result).toHaveValue(/^"Asha";"Pune";/);

  await page.locator("#j2c-file").setInputFiles({
    name: "people.json",
    mimeType: "application/json",
    buffer: Buffer.from('[{"x": 1}, {"x": 2}, {"x": 3}]'),
  });
  await expect(page.locator('[data-stat="rows"] dd')).toHaveText("3");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  expect((await download).suggestedFilename()).toBe("data.csv");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("explains JSON it cannot convert and the length limit", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#j2c-text").fill("[1, 2]");
  await expect(page.locator("#j2c-error")).toContainText("Item 1 of the array is not an object");
  await expect(page.getByRole("button", { name: "Download CSV" })).toBeDisabled();
  const shell = '[{"a":""}]';
  await page.locator("#j2c-text").fill(`[{"a":"${"x".repeat(1_000_001 - shell.length)}"}]`);
  await expect(page.locator("#j2c-error")).toContainText("the limit is 1,000,000");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await page.locator("#j2c-text").fill("{");
    await expect(page.locator("#j2c-error")).toBeVisible();
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
