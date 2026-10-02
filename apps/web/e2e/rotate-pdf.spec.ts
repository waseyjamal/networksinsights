import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/pdf/rotate-pdf/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { makeTestPdf, pdfPages } from "./support/test-pdf";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Rotate PDF against `wrangler dev` (real CSP and headers): pdf-lib, imported on demand, turns the
// pages of a real PDF; the result is read back to check each page's rotation. Also: chosen pages,
// pages outside the PDF, protected and damaged PDFs, and the 50 MB limit at and over the edge.

test.use({ baseURL: edgeURL });
// PDF work and 50 MB files take longer than the default 30 seconds on a slow machine.
test.setTimeout(180_000);

const PATH = "/rotate-pdf/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const file = (page: Page) => page.locator("#rotate-pdf-file");
const result = (page: Page) => page.getByRole("list", { name: "Rotated PDF" }).locator("li");
const SCAN = makeTestPdf("scan.pdf", 5);

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

test("turns pages 2, 4-5 clockwise, as the page example says", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(SCAN);
  await expect(page.locator("#rotate-pdf-original")).toContainText("scan.pdf: 5 pages", {
    timeout: 30_000,
  });
  await page.locator("#rotate-pdf-which").selectOption("chosen");
  await page.locator("#rotate-pdf-pages").fill("2, 4-5");
  await page.getByRole("button", { name: "Rotate", exact: true }).click();
  await expect(result(page)).toContainText("3 pages turned", { timeout: 30_000 });
  const pages = await pdfPages(await download(page, "scan-rotated.pdf"));
  expect(pages.map((p) => p.rotation)).toEqual([0, 90, 0, 90, 90]);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("turns all pages 180°, and counterclockwise is 270", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(SCAN);
  await expect(page.locator("#rotate-pdf-original")).toBeVisible({ timeout: 30_000 });
  await page.locator("#rotate-pdf-turn").selectOption("180");
  await page.getByRole("button", { name: "Rotate", exact: true }).click();
  await expect(result(page)).toContainText("5 pages turned", { timeout: 30_000 });
  let pages = await pdfPages(await download(page, "scan-rotated.pdf"));
  expect(pages.map((p) => p.rotation)).toEqual([180, 180, 180, 180, 180]);

  await page.locator("#rotate-pdf-turn").selectOption("270");
  await page.getByRole("button", { name: "Rotate", exact: true }).click();
  await expect(result(page)).toBeVisible({ timeout: 30_000 });
  pages = await pdfPages(await download(page, "scan-rotated.pdf"));
  expect(pages.map((p) => p.rotation)).toEqual([270, 270, 270, 270, 270]);
});

test("refuses a page the PDF does not have, with the real page count", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(SCAN);
  await expect(page.locator("#rotate-pdf-original")).toBeVisible({ timeout: 30_000 });
  await page.locator("#rotate-pdf-which").selectOption("chosen");
  await page.locator("#rotate-pdf-pages").fill("6");
  await page.getByRole("button", { name: "Rotate", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Page 6 does not exist: this PDF has 5 pages.");
  await expect(result(page)).toHaveCount(0);
});

test("refuses a password-protected PDF and a damaged one", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("locked.pdf", 1, { encrypted: true }));
  await expect(
    page.getByText(
      "locked.pdf: This PDF is protected with a password. Remove the password in the program that made it, then try again.",
    ),
  ).toBeVisible({ timeout: 30_000 });
  await file(page).setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 nothing"),
  });
  await expect(
    page.getByText("broken.pdf: This PDF could not be read. It may be damaged or not a real PDF."),
  ).toBeVisible({ timeout: 30_000 });
});

test("refuses a PDF one byte over 50 MB, and rotates one of exactly 50 MB", async ({
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
  await expect(page.locator("#rotate-pdf-original")).toContainText("big.pdf: 2 pages", {
    timeout: 120_000,
  });
  await page.getByRole("button", { name: "Rotate", exact: true }).click();
  await expect(result(page)).toContainText("2 pages turned", { timeout: 120_000 });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(SCAN);
    await expect(page.locator("#rotate-pdf-original")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Rotate", exact: true }).click();
    await expect(result(page)).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
