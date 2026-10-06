import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { PDFDocument, rgb, StandardFonts } from "../../../tools/node_modules/pdf-lib/cjs/index.js";
import manifest from "../../../tools/pdf/pdf-to-text/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { makeTestPdf, type TestPdf } from "./support/test-pdf";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// PDF to Text against `wrangler dev` (real CSP and headers): PDF.js, inside the tool's own worker,
// reads the text of real PDFs. The downloaded .txt is read back. Also: a PDF with no text (as a
// scan is) and a page with none, chosen pages, protected and damaged PDFs, and the 50 MB limit at
// and over the edge.

test.use({ baseURL: edgeURL });
test.setTimeout(180_000);

const PATH = "/pdf-to-text/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const file = (page: Page) => page.locator("#pdf-to-text-file");
const result = (page: Page) => page.locator("#pdf-to-text-result");
const REPORT = makeTestPdf("report.pdf", 3);

async function opened(page: Page, text: string) {
  await expect(page.locator("#pdf-to-text-original")).toContainText(text, { timeout: 60_000 });
}

/** A PDF whose pages hold only shapes, as a scanned page holds only a picture; or one of each. */
async function shapesPdf(name: string, withText: boolean): Promise<TestPdf> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  if (withText) {
    document.addPage([300, 400]).drawText("Words here", { x: 40, y: 200, size: 24, font });
  }
  document
    .addPage([300, 400])
    .drawRectangle({ x: 20, y: 20, width: 200, height: 300, color: rgb(0.2, 0.3, 0.4) });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await document.save()) };
}

test("reads the text of every page, adds page lines, and downloads the .txt", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(REPORT);
  await opened(page, "report.pdf: 3 pages");
  await page.getByRole("button", { name: "Get text" }).click();
  await expect(result(page)).toHaveValue("Page 1\n\nPage 2\n\nPage 3\n", { timeout: 60_000 });
  await expect(page.locator("#pdf-to-text-summary")).toHaveText("3 pages read, 6 words.");

  await page.getByLabel("Start each page with a line such as --- Page 2 ---").check();
  await expect(result(page)).toHaveValue(
    "--- Page 1 ---\nPage 1\n\n--- Page 2 ---\nPage 2\n\n--- Page 3 ---\nPage 3\n",
  );

  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download .txt" }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe("report.txt");
  expect(readFileSync((await saved.path()) ?? "", "utf8")).toBe(
    "--- Page 1 ---\nPage 1\n\n--- Page 2 ---\nPage 2\n\n--- Page 3 ---\nPage 3\n",
  );
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("reads only the chosen pages, and refuses pages the PDF does not have", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(REPORT);
  await opened(page, "3 pages");
  await page.locator("#pdf-to-text-which").selectOption("chosen");
  await page.locator("#pdf-to-text-pages").fill("4");
  await page.getByRole("button", { name: "Get text" }).click();
  await expect(page.getByRole("alert")).toHaveText("Page 4 does not exist: this PDF has 3 pages.");
  await page.locator("#pdf-to-text-pages").fill("2-");
  await page.getByRole("button", { name: "Get text" }).click();
  await expect(result(page)).toHaveValue("Page 2\n\nPage 3\n", { timeout: 60_000 });
});

test("says a PDF with no text is probably scanned and points to OCR; names an empty page", async ({
  page,
}) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(await shapesPdf("scan.pdf", false));
  await opened(page, "scan.pdf: 1 page");
  await page.getByRole("button", { name: "Get text" }).click();
  await expect(page.getByText("No text was found on these pages.")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("link", { name: "Open the OCR tool" })).toHaveAttribute(
    "href",
    "/ocr/",
  );
  await expect(result(page)).toHaveCount(0);

  await file(page).setInputFiles(await shapesPdf("mixed.pdf", true));
  await opened(page, "mixed.pdf: 2 pages");
  await page.getByRole("button", { name: "Get text" }).click();
  await expect(result(page)).toHaveValue("Words here\n", { timeout: 60_000 });
  await expect(page.locator("#pdf-to-text-summary")).toHaveText(
    "2 pages read, 2 words. No text on page 2: it may be a picture.",
  );
});

test("refuses a password-protected PDF and a damaged one", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("locked.pdf", 1, { encrypted: true }));
  await expect(
    page.getByText(
      "locked.pdf: This PDF is protected with a password. Remove the password first, then try again.",
    ),
  ).toBeVisible({ timeout: 60_000 });
  await file(page).setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 nothing here at all"),
  });
  await expect(
    page.getByText("broken.pdf: This PDF could not be read. It may be damaged or not a real PDF."),
  ).toBeVisible({ timeout: 60_000 });
});

test("refuses a PDF one byte over 50 MB, and reads one of exactly 50 MB", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const over = testInfo.outputPath("over.pdf");
  writeFileSync(over, makeTestPdf("over.pdf", 1, { padding: LIMIT + 1 }).buffer);
  await file(page).setInputFiles(over);
  await expect(page.getByText("over.pdf: This file is larger than 50 MB.")).toBeVisible();

  const atLimit = testInfo.outputPath("big.pdf");
  writeFileSync(atLimit, makeTestPdf("big.pdf", 2, { padding: LIMIT }).buffer);
  await file(page).setInputFiles(atLimit);
  await opened(page, "big.pdf: 2 pages");
  await page.getByRole("button", { name: "Get text" }).click();
  await expect(result(page)).toHaveValue("Page 1\n\nPage 2\n", { timeout: 120_000 });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with text shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(REPORT);
    await opened(page, "3 pages");
    await page.getByRole("button", { name: "Get text" }).click();
    await expect(result(page)).toHaveValue(/Page 3/, { timeout: 60_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
