import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/web-seo/schema-markup-generator/tool.config";
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

// Schema Markup Generator against `wrangler dev` (real CSP and headers): the Product example of its
// page, each type giving valid JSON-LD, required fields, the FAQ notice and limits, and axe.

test.use({ baseURL: edgeURL });

const PATH = "/schema-markup-generator/";
const output = (page: Page) => page.locator("#schema-output");

/** The JSON inside the script tag of the output box. */
async function jsonOf(page: Page) {
  const text = await output(page).inputValue();
  const match = /^<script type="application\/ld\+json">\n([\s\S]*)\n<\/script>$/.exec(text);
  if (!match) throw new Error(`not a JSON-LD script: ${text}`);
  return JSON.parse(match[1] ?? "");
}

test("renders the Product example without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(output(page)).toHaveValue(/"name": "Sourdough Loaf"/);
  await context.close();
});

test("gives the Product of its page and needs a price with a dot", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  expect(await jsonOf(page)).toEqual({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Sourdough Loaf",
    brand: { "@type": "Brand", name: "Example Bakery" },
    offers: {
      "@type": "Offer",
      price: "6.50",
      priceCurrency: "GBP",
      availability: "https://schema.org/InStock",
    },
  });
  await page.locator("#schema-price").fill("6,50");
  await expect(page.locator("#schema-price-error")).toHaveText(
    "Use a number with a dot for decimals, such as 19.99.",
  );
  await expect(output(page)).toHaveValue("");
  await expect(page.getByRole("button", { name: "Copy JSON-LD" })).toBeDisabled();
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("writes an Article, a LocalBusiness and an Organization", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#schema-type").selectOption("Article");
  await page.locator("#schema-headline").fill("How we bake");
  await page.locator("#schema-datePublished").fill("2026-10-03");
  expect(await jsonOf(page)).toEqual({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "How we bake",
    datePublished: "2026-10-03",
  });

  await page.locator("#schema-type").selectOption("LocalBusiness");
  await expect(page.locator("#schema-name-error")).toHaveText("Business name is required.");
  await page.locator("#schema-name").fill("Example Bakery");
  await page.locator("#schema-streetAddress").fill("1 High Street");
  await page.locator("#schema-addressLocality").fill("Leeds");
  expect((await jsonOf(page)).address).toEqual({
    "@type": "PostalAddress",
    streetAddress: "1 High Street",
    addressLocality: "Leeds",
  });

  await page.locator("#schema-type").selectOption("Organization");
  await page.locator("#schema-name").fill("Example Bakery");
  await page.locator("#schema-sameAs").fill("https://example.social/a\nhttps://example.social/b");
  expect((await jsonOf(page)).sameAs).toEqual([
    "https://example.social/a",
    "https://example.social/b",
  ]);
});

test("writes a FAQPage, notes the retired rich result, and stops at 20 questions", async ({
  page,
}) => {
  // Nineteen rounds of add, render, focus and scroll, each checked, take longer than 30 seconds in
  // WebKit on a slow machine; the assertions are unchanged.
  test.slow();
  // The button's hover transform transition keeps it moving under the pointer in WebKit after each
  // click scrolls it, so Playwright never sees it stable; reduced motion switches it off.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTool(page, PATH);
  await page.locator("#schema-type").selectOption("FAQPage");
  await expect(page.getByText("Google no longer shows FAQ rich results")).toBeVisible();
  await expect(page.locator("main")).toContainText(
    "Google stopped showing FAQ rich results in Search on 7 May 2026",
  );
  await page.locator("#schema-question-1").fill("Do you deliver?");
  await page.locator("#schema-answer-1").fill("Yes, within the city.");
  expect((await jsonOf(page)).mainEntity).toEqual([
    {
      "@type": "Question",
      name: "Do you deliver?",
      acceptedAnswer: { "@type": "Answer", text: "Yes, within the city." },
    },
  ]);
  const add = page.getByRole("button", { name: "Add question" });
  for (let n = 2; n <= 20; n++) {
    await add.click();
    await expect(page.locator(`#schema-question-${n}`)).toBeFocused();
    await expect(add).toBeInViewport();
  }
  await expect(add).toBeDisabled();
});

test("takes a field of 2,000 characters and refuses 2,001", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#schema-brand").fill("a".repeat(2001));
  await expect(page.locator("#schema-brand-error")).toHaveText("Keep this under 2000 characters.");
  await page.locator("#schema-brand").fill("a".repeat(2000));
  await expect(page.locator("#schema-brand-error")).toHaveCount(0);
  expect((await jsonOf(page)).brand.name).toHaveLength(2000);
});

test("copies the JSON-LD", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium lets a test grant clipboard access");
  await context.grantPermissions(["clipboard-write"]);
  await openTool(page, PATH);
  await page.getByRole("button", { name: "Copy JSON-LD" }).click();
  await expect(page.getByText("JSON-LD copied to the clipboard.")).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expectNoAxeViolations(page);
    await page.locator("#schema-type").selectOption("FAQPage");
    await expect(page.locator("#schema-question-1-error")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
