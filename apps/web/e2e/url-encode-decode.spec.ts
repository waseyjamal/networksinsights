import { expect, test } from "@playwright/test";
import manifest from "../../../tools/developer/url-encode-decode/tool.config";
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

// URL Encode Decode in the three engines, against `wrangler dev` (real CSP and headers). It
// renders its first example without JavaScript, gives the examples of its page in both scopes and
// both directions, keeps each direction's own text, explains bad percent sequences, copies the
// result, and its structured data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/url-encode-decode/";
const input = (page: import("@playwright/test").Page) => page.locator("#url-input");
const output = (page: import("@playwright/test").Page) => page.locator("#url-output");

test("renders its first example without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(output(page)).toHaveValue("https://example.com/search?q=caf%C3%A9%20&%20tea");
  await context.close();
});

test("gives the examples of its page in both scopes and directions", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(output(page)).toHaveValue("https://example.com/search?q=caf%C3%A9%20&%20tea");

  await input(page).fill("café & tea");
  await page.getByLabel("Treat the text as").selectOption("component");
  await expect(output(page)).toHaveValue("caf%C3%A9%20%26%20tea");
  await input(page).fill("a b+c");
  await expect(output(page)).toHaveValue("a%20b%2Bc");

  await page.getByLabel("Action").selectOption("decode");
  await expect(input(page)).toHaveValue("");
  await input(page).fill("caf%C3%A9%20%26%20tea");
  await expect(output(page)).toHaveValue("café & tea");
  await page.getByLabel("Treat the text as").selectOption("url");
  await expect(output(page)).toHaveValue("café %26 tea");
  await input(page).fill("a+b%20c");
  await expect(output(page)).toHaveValue("a+b c");

  await page.getByLabel("Action").selectOption("encode");
  await expect(input(page)).toHaveValue("a b+c");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("explains bad percent sequences and clears the message when fixed", async ({ page }) => {
  await openTool(page, PATH);
  await page.getByLabel("Action").selectOption("decode");
  await input(page).fill("50% off");
  await expect(page.locator("#url-input-error")).toHaveText(
    'The "%" at character 3 is not followed by two hexadecimal digits (found "% o"). A percent sign must be written as %25 to stay a percent sign.',
  );
  await expect(input(page)).toHaveAttribute("aria-invalid", "true");
  await expect(output(page)).toHaveValue("");
  await expect(page.getByRole("button", { name: "Copy result" })).toBeDisabled();

  await input(page).fill("x%FFy");
  await expect(page.locator("#url-input-error")).toHaveText(
    'The percent sequences starting at character 2 ("%FF") are not valid UTF-8, so they do not stand for any text.',
  );
  await input(page).fill("50%25 off");
  await expect(page.locator("#url-input-error")).toHaveCount(0);
  await expect(output(page)).toHaveValue("50% off");
});

test("copies the result", async ({ page }) => {
  // The page may write to the clipboard but its policy blocks reading it back, so the test records
  // what is written.
  await page.addInitScript(() => {
    (window as unknown as { __copied: string[] }).__copied = [];
    navigator.clipboard.writeText = async (text: string) => {
      (window as unknown as { __copied: string[] }).__copied.push(text);
    };
  });
  await openTool(page, PATH);
  await page.getByRole("button", { name: "Copy result" }).click();
  await expect(page.getByText("Result copied to the clipboard.")).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  expect(copied).toEqual(["https://example.com/search?q=caf%C3%A9%20&%20tea"]);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await page.getByLabel("Action").selectOption("decode");
    await input(page).fill("%zz");
    await expect(page.locator("#url-input-error")).toBeVisible();
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
