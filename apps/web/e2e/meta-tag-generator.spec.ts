import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/web-seo/meta-tag-generator/tool.config";
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

// Meta Tag Generator against `wrangler dev` (real CSP and headers): the example of its page, the
// escaping, the approximate preview and rule-of-thumb guide, the 2,000 character cap at and over
// the edge, and axe in both themes.

test.use({ baseURL: edgeURL });

const PATH = "/meta-tag-generator/";
const html = (page: Page) => page.locator("#meta-html");

test("renders the example tags without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(html(page)).toHaveValue(/^<title>Fresh Sourdough Bread<\/title>\n/);
  await context.close();
});

test("writes and escapes the tags, and labels the preview approximate", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(html(page)).toHaveValue(
    /<link rel="canonical" href="https:\/\/example.com\/bread\/sourdough">/,
  );
  await page.locator("#meta-title").fill('Tom & "Jerry"');
  await expect(html(page)).toHaveValue(/<title>Tom &amp; &quot;Jerry&quot;<\/title>/);
  await expect(page.locator("#meta-preview")).toContainText('Tom & "Jerry"');
  await expect(page.locator("#meta-preview")).toContainText("example.com › bread › sourdough");
  await expect(
    page.getByRole("heading", { name: "Search result preview (approximate)" }),
  ).toBeVisible();
  await expect(page.locator("#meta-title-hint")).toHaveText(
    "13 characters. Rule of thumb: about 60 often show in full; search engines cut by pixel width.",
  );
  await page.locator("#meta-twitter-site").fill("example");
  await page.locator("#meta-robots").selectOption("noindex, nofollow");
  await expect(html(page)).toHaveValue(/<meta name="twitter:site" content="@example">/);
  await expect(html(page)).toHaveValue(/<meta name="robots" content="noindex, nofollow">/);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("refuses a relative canonical and a description one character over the cap", async ({
  page,
}) => {
  await openTool(page, PATH);
  await page.locator("#meta-canonical").fill("/bread");
  await expect(page.locator("#meta-canonical-error")).toHaveText(
    "Use a full address that starts with https:// or http://.",
  );
  await expect(page.getByRole("button", { name: "Copy HTML" })).toBeDisabled();
  await page.locator("#meta-canonical").fill("");
  await page.locator("#meta-description").fill("a".repeat(2001));
  await expect(page.locator("#meta-description-error")).toHaveText(
    "Keep this under 2000 characters.",
  );
  await page.locator("#meta-description").fill("a".repeat(2000));
  await expect(page.locator("#meta-description-error")).toHaveCount(0);
  await expect(html(page)).toHaveValue(/content="a{2000}"/);
});

test("copies the HTML", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium lets a test grant clipboard access");
  await context.grantPermissions(["clipboard-write"]);
  await openTool(page, PATH);
  await page.getByRole("button", { name: "Copy HTML" }).click();
  await expect(page.getByText("HTML copied to the clipboard.")).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await page.locator("#meta-title").fill("");
    await expect(page.locator("#meta-title-error")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
