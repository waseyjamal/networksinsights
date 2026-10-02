import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/pdf/pdf-to-jpg/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { makeTestPdf } from "./support/test-pdf";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// PDF to JPG against `wrangler dev` (real CSP and headers): PDF.js, inside the tool's own worker,
// draws real PDF pages; the pictures have the sizes the page quotes and the page text is really
// drawn (Helvetica comes from the standard fonts served from this site). Also: the 4,096-pixel
// cap, the 50-page run limit, protected and damaged PDFs, and the 50 MB limit at and over the edge.

test.use({ baseURL: edgeURL });
// PDF work and 50 MB files take longer than the default 30 seconds on a slow machine.
test.setTimeout(180_000);

const PATH = "/pdf-to-jpg/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const A4: [number, number] = [595.28, 841.89];
const file = (page: Page) => page.locator("#pdf-to-jpg-file");
const pictures = (page: Page) => page.getByRole("list", { name: "Page pictures" }).locator("li");
const REPORT = makeTestPdf("report.pdf", 3, { size: A4 });

async function opened(page: Page, text: string) {
  await expect(page.locator("#pdf-to-jpg-original")).toContainText(text, { timeout: 60_000 });
}

/** How many of the picture's pixels are dark: text drawn in black. */
const darkPixels = (page: Page, index: number) =>
  pictures(page)
    .nth(index)
    .locator("img")
    .evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d");
      context?.drawImage(img, 0, 0);
      const data = context?.getImageData(0, 0, canvas.width, canvas.height).data ?? [];
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i] ?? 255) < 80 && (data[i + 1] ?? 255) < 80 && (data[i + 2] ?? 255) < 80) dark++;
      }
      return dark;
    });

test("draws A4 pages at 150 dpi as 1,240 by 1,753 JPGs with their text, in the worker", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(REPORT);
  await opened(page, "report.pdf: 3 pages");
  await page.getByRole("button", { name: "Convert" }).click();
  await expect(pictures(page)).toHaveCount(3, { timeout: 60_000 });
  await expect(pictures(page).first()).toContainText("report-page-1.jpg");
  await expect(pictures(page).first()).toContainText("1240 × 1753 pixels");
  expect(await darkPixels(page, 0)).toBeGreaterThan(500);

  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download report-page-2.jpg" }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe("report-page-2.jpg");
  const bytes = readFileSync((await saved.path()) ?? "");
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("Print is 2,480 by 3,507; a poster stops at 4,096 pixels; chosen pages only", async ({
  page,
}) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(REPORT);
  await opened(page, "3 pages");
  await page.locator("#pdf-to-jpg-which").selectOption("chosen");
  await page.locator("#pdf-to-jpg-pages").fill("2");
  await page.locator("#pdf-to-jpg-resolution").selectOption("300");
  await page.getByRole("button", { name: "Convert" }).click();
  await expect(pictures(page)).toHaveCount(1, { timeout: 60_000 });
  await expect(pictures(page).first()).toContainText("report-page-2.jpg");
  await expect(pictures(page).first()).toContainText("2480 × 3507 pixels");

  await file(page).setInputFiles(makeTestPdf("poster.pdf", 1, { size: [2384, 3370] }));
  await opened(page, "poster.pdf: 1 page");
  await page.locator("#pdf-to-jpg-which").selectOption("all");
  await page.getByRole("button", { name: "Convert" }).click();
  await expect(pictures(page).first()).toContainText("× 4096 pixels", { timeout: 60_000 });
});

test("refuses 51 pages in one run, and pages the PDF does not have", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("long.pdf", 51));
  await opened(page, "long.pdf: 51 pages");
  await page.getByRole("button", { name: "Convert" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "That is 51 pages. Up to 50 pages can be turned into pictures at a time: choose fewer, then run again for the rest.",
  );
  await page.locator("#pdf-to-jpg-which").selectOption("chosen");
  await page.locator("#pdf-to-jpg-pages").fill("52");
  await page.getByRole("button", { name: "Convert" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Page 52 does not exist: this PDF has 51 pages.",
  );
  await expect(pictures(page)).toHaveCount(0);
});

test("refuses a password-protected PDF and a damaged one", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("locked.pdf", 1, { encrypted: true }));
  await expect(
    page.getByText(
      "locked.pdf: This PDF is protected with a password. Remove the password in the program that made it, then try again.",
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

test("refuses a PDF one byte over 50 MB, and converts one of exactly 50 MB", async ({
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
  await page.getByRole("button", { name: "Convert" }).click();
  await expect(pictures(page)).toHaveCount(2, { timeout: 120_000 });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with pictures shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(REPORT);
    await opened(page, "3 pages");
    await page.getByRole("button", { name: "Convert" }).click();
    await expect(pictures(page)).toHaveCount(3, { timeout: 60_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
