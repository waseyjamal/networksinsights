import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/generators/invoice-generator/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { pdfPages } from "./support/test-pdf";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Invoice Generator against `wrangler dev` (real CSP and headers): the example of its page gives the
// totals the page quotes, on screen and in the A4 PDF; 0.1 plus 0.2 is exactly 0.30; the line-item,
// quantity, price and percent limits at and over the edge; undrawable characters are named.

test.use({ baseURL: edgeURL });
test.setTimeout(120_000);

const PATH = "/invoice-generator/";
const totals = (page: Page) => page.locator("#invoice-totals");
const result = (page: Page) => page.getByRole("list", { name: "Your invoice" }).locator("li");
const make = (page: Page) => page.getByRole("button", { name: "Make PDF" });

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

/** The text drawn in a pdf-lib PDF: content streams inflated, hex strings decoded (WinAnsi). */
function pdfText(pdf: Buffer): string[] {
  const out: string[] = [];
  const raw = pdf.toString("latin1");
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let match = streams.exec(raw); match; match = streams.exec(raw)) {
    let body: string;
    try {
      body = inflateSync(Buffer.from(match[1] ?? "", "latin1")).toString("latin1");
    } catch {
      body = match[1] ?? "";
    }
    for (const hex of body.matchAll(/<([0-9A-Fa-f]+)> Tj/g)) {
      out.push(Buffer.from(hex[1] ?? "", "hex").toString("latin1"));
    }
  }
  return out;
}

test("the example of its page gives the quoted totals, on screen and in the PDF", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(totals(page).locator("dd")).toHaveText(["£609.97", "-£61.00", "£109.79", "£658.76"]);
  await expect(page.locator("#invoice-item-2-amount")).toHaveText("£59.97");
  await make(page).click();
  await expect(result(page)).toContainText("1 page", { timeout: 30_000 });
  const pdf = await download(page, "invoice-INV-001.pdf");
  expect((await pdfPages(pdf)).map((p) => [Math.round(p.width), Math.round(p.height)])).toEqual([
    [595, 842],
  ]);
  const text = pdfText(pdf);
  expect(text[0]).toBe("INVOICE");
  // The pound sign is 0xA3 in WinAnsi, the same byte as in Latin-1.
  for (const line of [
    "Subtotal",
    "£609.97",
    "Discount (10%)",
    "-£61.00",
    "Tax (20%)",
    "£109.79",
    "Total",
    "£658.76",
    "2.5",
  ]) {
    expect(text).toContain(line);
  }
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("0.1 plus 0.2 is exactly 0.30, and the sign follows the choice", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#invoice-item-1-price").fill("0.1");
  await page.locator("#invoice-item-2-quantity").fill("1");
  await page.locator("#invoice-item-2-price").fill("0.2");
  await page.getByRole("button", { name: "Remove item 3" }).click();
  await page.locator("#invoice-discount").fill("");
  await page.locator("#invoice-tax").fill("");
  await page.locator("#invoice-currency").selectOption("usd");
  await expect(totals(page).locator("dd").last()).toHaveText("$0.30");
  await page.locator("#invoice-currency").selectOption("inr");
  await expect(totals(page).locator("dd").last()).toHaveText("Rs 0.30");
  await page.locator("#invoice-discount-type").selectOption("amount");
  await page.locator("#invoice-discount").fill("5");
  await expect(totals(page).locator("dd").last()).toHaveText("Rs 0.00");
});

test("refuses values over each limit and takes the limit itself", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#invoice-item-1-quantity").fill("1000000.001");
  await expect(page.locator("#invoice-item-1-quantity-error")).toHaveText("At most 1,000,000.");
  await page.locator("#invoice-item-1-quantity").fill("1000000");
  await page.locator("#invoice-item-1-price").fill("1000000000.01");
  await expect(page.locator("#invoice-item-1-price-error")).toHaveText("At most 1,000,000,000.");
  await page.locator("#invoice-item-1-price").fill("1.234");
  await expect(page.locator("#invoice-item-1-price-error")).toHaveText(
    "An amount with up to 2 decimals, such as 49.50.",
  );
  await page.locator("#invoice-item-1-price").fill("1000000000");
  await page.locator("#invoice-tax").fill("100.01");
  await expect(page.locator("#invoice-tax-error")).toHaveText(
    "A percent from 0 to 100, with up to 2 decimals.",
  );
  await expect(make(page)).toBeDisabled();
  await page.locator("#invoice-tax").fill("100");
  await expect(make(page)).toBeEnabled();
  await page.locator("#invoice-notes").fill("a".repeat(501));
  await expect(page.locator("#invoice-notes-error")).toHaveText("Keep this under 500 characters.");
  await page.locator("#invoice-notes").fill("a".repeat(500));
  await expect(page.locator("#invoice-notes-error")).toHaveCount(0);
});

test("takes 50 line items, not 51, and keeps the Add button in view", async ({ page }) => {
  // 47 checked rounds of add, focus, scroll and fill. WebKit draws a frame in about half a second
  // on a slow machine and every click waits for frames, so this needs more than the default time;
  // the assertions are the same in every browser. Reduced motion switches off the button's hover
  // transition, which otherwise keeps it moving under the pointer after each scroll in WebKit.
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTool(page, PATH);
  const add = page.getByRole("button", { name: "Add item" });
  for (let i = 3; i < 50; i++) {
    await add.click();
    await expect(page.locator(`#invoice-item-${i + 1}-description`)).toBeFocused();
    await expect(add).toBeInViewport();
    await page.locator(`#invoice-item-${i + 1}-description`).fill(`Item ${i + 1}`);
    await page.locator(`#invoice-item-${i + 1}-price`).fill("1");
  }
  await expect(add).toBeDisabled();
  await make(page).click();
  await expect(result(page)).toContainText("pages", { timeout: 30_000 });
});

test("names the characters the PDF fonts cannot draw", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#invoice-buyer").fill("Łódź ₹");
  await expect(page.locator("#invoice-problems")).toHaveText(
    "The PDF fonts cannot draw these characters: Ł ź ₹. They cover English and most Western European letters only. Replace them.",
  );
  await expect(make(page)).toBeDisabled();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await make(page).click();
    await expect(result(page)).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page);
    await page.locator("#invoice-item-1-price").fill("x");
    await expect(page.locator("#invoice-item-1-price-error")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
