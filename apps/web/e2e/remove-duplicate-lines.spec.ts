import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/text/remove-duplicate-lines/tool.config";
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

// Remove Duplicate Lines in the three engines, against `wrangler dev` (real CSP and headers). It
// renders the example of its page without JavaScript, applies each option, handles a 1 MB text and
// refuses one character more, and its structured data and Quick facts match.

test.use({ baseURL: edgeURL });

const PATH = "/remove-duplicate-lines/";
const cell = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);

test("renders the example of its page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(cell(page, "before")).toHaveText("6");
  await expect(cell(page, "removed")).toHaveText("1");
  await context.close();
});

test("applies each option", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  const result = page.locator("#rdl-result");
  await expect(result).toHaveValue("apple\nBanana\nbanana\n\ncherry");

  await page.getByLabel("Ignore case").check();
  await page.getByLabel("Remove empty lines").check();
  await expect(result).toHaveValue("apple\nBanana\ncherry");
  await expect(cell(page, "removed")).toHaveText("3");

  await page.locator("#rdl-keep").selectOption("last");
  await expect(result).toHaveValue("apple\nbanana\ncherry");
  await page.locator("#rdl-sort").selectOption("desc");
  await expect(result).toHaveValue("cherry\nbanana\napple");

  await page.locator("#rdl-text").fill("  a\na  ");
  await page.getByLabel("Trim spaces").check();
  await expect(result).toHaveValue("a");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

/** Pastes the text in one input event, as a real paste does; `fill` types it far more slowly. */
async function paste(page: Page, text: string) {
  await page.evaluate((value) => {
    const area = document.querySelector<HTMLTextAreaElement>("#rdl-text");
    if (!area) throw new Error("no workspace");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

test("handles 1 MB and refuses one character more", async ({ page }) => {
  // WebKit is several times slower than the others with 1 MB in two text boxes: allow for it.
  test.slow();
  await openTool(page, PATH);
  const lines = Array.from(
    { length: 100_000 },
    (_, i) => `line${String(i % 50_000).padStart(5, "0")}`,
  );
  const text = `${lines.join("\n")}\n`;
  expect(text).toHaveLength(1_000_000);
  await paste(page, text);
  await expect(cell(page, "removed")).toHaveText("50,000", { timeout: 30_000 });
  await expect(cell(page, "before")).toHaveText("100,000");
  await paste(page, `${text}x`);
  await expect(page.locator("#rdl-error")).toContainText("the limit is 1,000,000", {
    timeout: 30_000,
  });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
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
