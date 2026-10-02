import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/pdf/split-pdf/tool.config";
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

// Split PDF against `wrangler dev` (real CSP and headers): a real 6-page PDF is counted and split
// by pdf-lib in the worker, by the ranges its page quotes and into every page. Also: ranges
// outside the PDF, a password-protected and a damaged PDF, and the 50 MB limit at and over the edge.

test.use({ baseURL: edgeURL });
// PDF work and 50 MB files take longer than the default 30 seconds on a slow machine.
test.setTimeout(180_000);

const PATH = "/split-pdf/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const file = (page: Page) => page.locator("#split-pdf-file");
const parts = (page: Page) => page.getByRole("list", { name: "Split PDFs" }).locator("li");
const REPORT = makeTestPdf("report.pdf", 6);

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

test("splits by 1-3, 5, 6- into the three files the page example names", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(REPORT);
  await expect(page.locator("#split-pdf-original")).toContainText("report.pdf: 6 pages", {
    timeout: 30_000,
  });
  await page.locator("#split-pdf-ranges").fill("1-3, 5, 6-");
  await page.getByRole("button", { name: "Split" }).click();
  await expect(parts(page)).toHaveCount(3, { timeout: 30_000 });
  await expect(parts(page).nth(0)).toContainText("report-pages-1-3.pdf");
  await expect(parts(page).nth(1)).toContainText("report-page-5.pdf");
  await expect(parts(page).nth(2)).toContainText("report-page-6.pdf");

  expect(await pdfPages(await download(page, "report-pages-1-3.pdf"))).toHaveLength(3);
  expect(await pdfPages(await download(page, "report-page-5.pdf"))).toHaveLength(1);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("Every page gives six one-page files", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(REPORT);
  await expect(page.locator("#split-pdf-original")).toBeVisible({ timeout: 30_000 });
  await page.locator("#split-pdf-mode").selectOption("every");
  await page.getByRole("button", { name: "Split" }).click();
  await expect(parts(page)).toHaveCount(6, { timeout: 30_000 });
  await expect(parts(page).last()).toContainText("report-page-6.pdf");
});

test("refuses a range outside the PDF with the real page count", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(REPORT);
  await expect(page.locator("#split-pdf-original")).toBeVisible({ timeout: 30_000 });
  await page.locator("#split-pdf-ranges").fill("4-9");
  await page.getByRole("button", { name: "Split" }).click();
  await expect(page.getByRole("alert")).toHaveText("Page 9 does not exist: this PDF has 6 pages.");
  await page.locator("#split-pdf-ranges").fill("5-3");
  await page.getByRole("button", { name: "Split" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    '"5-3" runs backwards. Write the smaller page first.',
  );
  await expect(parts(page)).toHaveCount(0);
});

test("refuses a password-protected PDF, a damaged one and a file that is not a PDF", async ({
  page,
}) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("locked.pdf", 2, { encrypted: true }));
  await expect(
    page.getByText(
      "locked.pdf: This PDF is protected with a password. Remove the password in the program that made it, then try again.",
    ),
  ).toBeVisible({ timeout: 30_000 });
  await file(page).setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 nothing here"),
  });
  await expect(
    page.getByText("broken.pdf: This PDF could not be read. It may be damaged or not a real PDF."),
  ).toBeVisible({ timeout: 30_000 });
  await file(page).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("text"),
  });
  await expect(page.getByText("notes.txt: This file is not a PDF.")).toBeVisible();
});

test("refuses a PDF one byte over 50 MB, and splits one of exactly 50 MB", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const over = testInfo.outputPath("over.pdf");
  writeFileSync(over, makeTestPdf("over.pdf", 2, { padding: LIMIT + 1 }).buffer);
  await file(page).setInputFiles(over);
  await expect(page.getByText("over.pdf: This file is larger than 50 MB.")).toBeVisible();

  const atLimit = testInfo.outputPath("big.pdf");
  writeFileSync(atLimit, makeTestPdf("big.pdf", 4, { padding: LIMIT }).buffer);
  await file(page).setInputFiles(atLimit);
  await expect(page.locator("#split-pdf-original")).toContainText("big.pdf: 4 pages", {
    timeout: 120_000,
  });
  await page.locator("#split-pdf-ranges").fill("2-3");
  await page.getByRole("button", { name: "Split" }).click();
  await expect(parts(page)).toHaveCount(1, { timeout: 120_000 });
  await expect(parts(page).first()).toContainText("big-pages-2-3.pdf");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with parts shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(REPORT);
    await expect(page.locator("#split-pdf-original")).toBeVisible({ timeout: 30_000 });
    await page.locator("#split-pdf-mode").selectOption("every");
    await page.getByRole("button", { name: "Split" }).click();
    await expect(parts(page)).toHaveCount(6, { timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
