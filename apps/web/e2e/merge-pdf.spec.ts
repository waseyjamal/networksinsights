import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/pdf/merge-pdf/tool.config";
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

// Merge PDF against `wrangler dev` (real CSP and headers): real PDFs are joined by pdf-lib in the
// worker, in the order of the list. Each test PDF has its own page width, so the result shows
// which file every page came from. Also: reordering, removing, password-protected and damaged
// files, and the 50 MB and 20-file limits at and over the edge.

test.use({ baseURL: edgeURL });
// PDF work and 50 MB files take longer than the default 30 seconds on a slow machine.
test.setTimeout(180_000);

const PATH = "/merge-pdf/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const files = (page: Page) => page.locator("#merge-pdf-files");
const list = (page: Page) => page.getByRole("list", { name: "PDFs to merge" }).locator("li");
const result = (page: Page) => page.getByRole("list", { name: "Merged PDF" }).locator("li");

const A = makeTestPdf("a.pdf", 3, { size: [300, 400] });
const B = makeTestPdf("b.pdf", 2, { size: [310, 400] });
const C = makeTestPdf("c.pdf", 1, { size: [320, 400] });

async function download(page: Page, name: string) {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(file.suggestedFilename()).toBe(name);
  return readFileSync((await file.path()) ?? "");
}

test("merges three PDFs into one of 6 pages, in order, as the page example says", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await files(page).setInputFiles([A, B, C]);
  await expect(list(page)).toHaveCount(3);
  await page.getByRole("button", { name: "Merge 3 PDFs" }).click();
  await expect(result(page)).toContainText("6 pages", { timeout: 30_000 });

  const bytes = await download(page, "a-merged.pdf");
  expect((await pdfPages(bytes)).map((p) => p.width)).toEqual([300, 300, 300, 310, 310, 320]);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("Up, Down and Remove change what is merged", async ({ page }) => {
  await openTool(page, PATH);
  await files(page).setInputFiles([A, B, C]);
  await page.getByRole("button", { name: "Move c.pdf up" }).click();
  await page.getByRole("button", { name: "Move c.pdf up" }).click();
  await expect(list(page).first()).toContainText("1. c.pdf");
  await expect(page.getByRole("button", { name: "Move c.pdf up" })).toBeDisabled();
  await page.getByRole("button", { name: "Move a.pdf down" }).click();
  await expect(list(page).nth(2)).toContainText("3. a.pdf");
  await page.getByRole("button", { name: "Remove b.pdf" }).click();
  await expect(list(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Merge 2 PDFs" }).click();
  await expect(result(page)).toContainText("4 pages", { timeout: 30_000 });
  const bytes = await download(page, "c-merged.pdf");
  expect((await pdfPages(bytes)).map((p) => p.width)).toEqual([320, 300, 300, 300]);
});

test("needs two PDFs, and refuses a password-protected or damaged one by name", async ({
  page,
}) => {
  await openTool(page, PATH);
  await files(page).setInputFiles([A]);
  await page.getByRole("button", { name: "Merge 1 PDF" }).click();
  await expect(page.getByRole("alert")).toHaveText("Add at least two PDFs to merge.");

  await files(page).setInputFiles([makeTestPdf("locked.pdf", 1, { encrypted: true })]);
  await page.getByRole("button", { name: "Merge 2 PDFs" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "locked.pdf is protected with a password. Remove the password in the program that made it, then add it again.",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "Remove locked.pdf" }).click();
  await files(page).setInputFiles([
    { name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 nothing") },
  ]);
  await page.getByRole("button", { name: "Merge 2 PDFs" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "broken.pdf could not be read. It may be damaged or not a real PDF.",
    { timeout: 30_000 },
  );
});

test("refuses a PDF one byte over 50 MB, and merges one of exactly 50 MB", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  // Over 50 MB, so the files go through disk: Playwright passes no larger buffer.
  const over = testInfo.outputPath("over.pdf");
  writeFileSync(over, makeTestPdf("over.pdf", 1, { padding: LIMIT + 1 }).buffer);
  const atLimit = testInfo.outputPath("big.pdf");
  writeFileSync(atLimit, makeTestPdf("big.pdf", 2, { padding: LIMIT, size: [330, 400] }).buffer);

  await files(page).setInputFiles([over]);
  await expect(page.getByText("over.pdf: This file is larger than 50 MB.")).toBeVisible();
  await expect(list(page)).toHaveCount(0);

  await files(page).setInputFiles([atLimit]);
  await files(page).setInputFiles([C]);
  await page.getByRole("button", { name: "Merge 2 PDFs" }).click();
  await expect(result(page)).toContainText("3 pages", { timeout: 120_000 });
});

test("refuses a file that is not a PDF, and a 21st PDF", async ({ page }) => {
  await openTool(page, PATH);
  const many = Array.from({ length: 21 }, (_, i) => makeTestPdf(`f${i + 1}.pdf`, 1));
  await files(page).setInputFiles([
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("text") },
    ...many,
  ]);
  const alert = page.getByRole("status").filter({ hasText: "2 files were not added" });
  await expect(alert).toContainText("notes.txt: This file is not a PDF.");
  await expect(alert).toContainText("f21.pdf: Only 20 PDFs can be merged at once.");
  await expect(list(page)).toHaveCount(20);
  await page.getByRole("button", { name: "Merge 20 PDFs" }).click();
  await expect(result(page)).toContainText("20 pages", { timeout: 60_000 });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await files(page).setInputFiles([A, B]);
    await page.getByRole("button", { name: "Merge 2 PDFs" }).click();
    await expect(result(page)).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
