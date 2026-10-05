import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/pdf/delete-reorder-pdf-pages/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { makeTestPdf, pdfTexts } from "./support/test-pdf";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Delete and Reorder PDF Pages against `wrangler dev` (real CSP and headers): PDF.js draws the
// thumbnails and pdf-lib writes the new PDF in the tool's worker; each result is read back with
// PDF.js to check which pages it holds, in which order. Also: dragging, the keyboard path, the
// one-page rule, protected and damaged PDFs, 200 pages against 201, and 50 MB at and over the edge.

test.use({ baseURL: edgeURL });
// PDF work and 50 MB files take longer than the default 30 seconds on a slow machine.
test.setTimeout(180_000);

const PATH = "/delete-reorder-pdf-pages/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const file = (page: Page) => page.locator("#delete-reorder-pdf-pages-file");
const pages = (page: Page) => page.getByRole("list", { name: "Pages" }).locator("li");
const result = (page: Page) => page.getByRole("list", { name: "New PDF" }).locator("li");
const REPORT = makeTestPdf("report.pdf", 5);

async function opened(page: Page, text: string, timeout = 60_000) {
  await expect(page.locator("#delete-reorder-pdf-pages-original")).toContainText(text, {
    timeout,
  });
}

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

/** The "Page N" label of every page of a PDF, in order. */
async function labels(buffer: Buffer) {
  return (await pdfTexts(buffer)).map((text) => text.replace(/\s+/g, " ").trim());
}

test("deletes page 2 and moves page 5 to the front, as the page example says", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(REPORT);
  await opened(page, "report.pdf: 5 pages");
  await expect(pages(page)).toHaveCount(5);
  await page.getByRole("button", { name: "Delete page 2" }).click();
  await expect(page.getByRole("button", { name: "Delete page 2" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(pages(page).nth(1)).toContainText("(deleted)");
  for (let step = 0; step < 4; step++) {
    await page.getByRole("button", { name: "Move page 5 earlier" }).click();
  }
  await expect(page.getByRole("button", { name: "Move page 5 earlier" })).toBeDisabled();
  await expect(page.locator("#delete-reorder-pdf-pages-summary")).toHaveText(
    "The new PDF will have 4 pages.",
  );
  await page.getByRole("button", { name: "Save new PDF" }).click();
  await expect(result(page)).toContainText("4 pages, 1 deleted, order changed", {
    timeout: 30_000,
  });
  const saved = await download(page, "report-edited.pdf");
  expect(await labels(saved)).toEqual(["Page 5", "Page 1", "Page 3", "Page 4"]);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("draws a real thumbnail of every page", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(REPORT);
  await opened(page, "report.pdf: 5 pages");
  const thumbs = page.getByRole("img", { name: /^Thumbnail of page \d$/ });
  await expect(thumbs).toHaveCount(5);
  const dark = await thumbs.first().evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d");
    context?.drawImage(img, 0, 0);
    const data = context?.getImageData(0, 0, canvas.width, canvas.height).data ?? [];
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 255) < 100) count++;
    return { count, width: img.naturalWidth, height: img.naturalHeight };
  });
  // 300 by 400 points drawn with the longer side at 160 pixels; the "Page 1" text is dark.
  expect(dark.width).toBe(120);
  expect(dark.height).toBe(160);
  expect(dark.count).toBeGreaterThan(20);
});

test("drags page 3 to the front", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(REPORT);
  await opened(page, "report.pdf: 5 pages");
  await pages(page).nth(2).dragTo(pages(page).nth(0));
  await expect(pages(page).nth(0)).toContainText("1. Page 3");
  await page.getByRole("button", { name: "Save new PDF" }).click();
  await expect(result(page)).toContainText("5 pages, order changed", { timeout: 30_000 });
  const saved = await download(page, "report-edited.pdf");
  expect(await labels(saved)).toEqual(["Page 3", "Page 1", "Page 2", "Page 4", "Page 5"]);
});

test("moves a page from the keyboard, keeps the focus and announces the move", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(REPORT);
  await opened(page, "report.pdf: 5 pages");
  const later = page.getByRole("button", { name: "Move page 1 later" });
  await later.focus();
  await page.keyboard.press("Enter");
  await expect(later).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByRole("status")).toHaveText("Page 1 moved to position 3 of 5.");
  await expect(pages(page).nth(2)).toContainText("3. Page 1");
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(pages(page).nth(0)).toContainText("1. Page 1");
});

test("keeps at least one page", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("two.pdf", 2));
  await opened(page, "two.pdf: 2 pages");
  await page.getByRole("button", { name: "Delete page 1" }).click();
  await page.getByRole("button", { name: "Delete page 2" }).click();
  await page.getByRole("button", { name: "Save new PDF" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Every page is marked for deletion. Keep at least one page.",
  );
  await expect(result(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Delete page 2" }).click();
  await page.getByRole("button", { name: "Save new PDF" }).click();
  await expect(result(page)).toContainText("1 page, 1 deleted", { timeout: 30_000 });
  expect(await labels(await download(page, "two-edited.pdf"))).toEqual(["Page 2"]);
});

test("refuses a password-protected PDF and a damaged one", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("locked.pdf", 1, { ownerPassword: "owner" }));
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

test("opens a PDF of 200 pages and refuses one of 201", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("long.pdf", 201));
  await expect(
    page.getByText(
      "long.pdf: This PDF has 201 pages. This tool takes at most 200 pages; split it first.",
    ),
  ).toBeVisible({ timeout: 60_000 });
  await file(page).setInputFiles(makeTestPdf("max.pdf", 200));
  await opened(page, "max.pdf: 200 pages", 150_000);
  await expect(pages(page)).toHaveCount(200);
});

test("refuses a PDF one byte over 50 MB, and opens one of exactly 50 MB", async ({
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
  await opened(page, "big.pdf: 2 pages", 120_000);
  await page.getByRole("button", { name: "Move page 2 earlier" }).click();
  await page.getByRole("button", { name: "Save new PDF" }).click();
  await expect(result(page)).toContainText("2 pages, order changed", { timeout: 120_000 });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a deleted page and a result, ${theme} theme`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(REPORT);
    await opened(page, "report.pdf: 5 pages");
    await page.getByRole("button", { name: "Delete page 2" }).click();
    await page.getByRole("button", { name: "Save new PDF" }).click();
    await expect(result(page)).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
