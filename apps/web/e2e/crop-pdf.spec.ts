import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { PDFDocument } from "../../../tools/node_modules/pdf-lib/cjs/index.js";
import manifest from "../../../tools/pdf/crop-pdf/tool.config";
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

// Crop PDF against `wrangler dev` (real CSP and headers): PDF.js draws the first page, pdf-lib sets
// the boxes, and the downloaded file is read back with pdf-lib in Node to check every page's
// MediaBox and CropBox, upright and turned. The text outside the kept area is checked to still be
// in the file, as the page says. Also: the outline moved with the keyboard, margins that leave
// nothing, and a protected PDF.

test.use({ baseURL: edgeURL });
test.setTimeout(120_000);

const PATH = "/crop-pdf/";
const PT_PER_MM = 72 / 25.4;
const file = (page: Page) => page.locator("#crop-pdf-file");
const result = (page: Page) => page.getByRole("list", { name: "Cropped PDF" }).locator("li");
const A4 = makeTestPdf("report.pdf", 2, { size: [595, 842] });

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

async function boxes(bytes: Buffer) {
  const document = await PDFDocument.load(bytes);
  return document
    .getPages()
    .map((page) => ({ media: page.getMediaBox(), crop: page.getCropBox() }));
}

async function setMargins(page: Page, top: string, right: string, bottom: string, left: string) {
  await page.locator("#crop-pdf-top").fill(top);
  await page.locator("#crop-pdf-right").fill(right);
  await page.locator("#crop-pdf-bottom").fill(bottom);
  await page.locator("#crop-pdf-left").fill(left);
}

test("crops every page of an A4 PDF, as the page example says", async ({ page, browserName }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(A4);
  await expect(page.locator("#crop-pdf-original")).toHaveText(
    "report.pdf: 2 pages, first page 209.9 mm × 297.0 mm",
    { timeout: 30_000 },
  );
  // The first page is drawn where the browser has OffscreenCanvas in a worker; elsewhere the page
  // says so and shows the outline on a blank page. Cropping is the same either way.
  // Chromium and Firefox must draw it. WebKit may lack OffscreenCanvas in a worker (WebKit on
  // Windows does): then the page says so and shows the outline on a blank page.
  const picture = page.locator("#crop-pdf-canvas img");
  if (browserName === "webkit") {
    await expect(picture.or(page.locator("#crop-pdf-no-preview"))).toBeVisible();
  } else await expect(picture).toBeVisible();
  await setMargins(page, "20", "10", "10", "10");
  await page.getByRole("button", { name: "Crop", exact: true }).click();
  await expect(result(page)).toContainText("2 pages cropped", { timeout: 30_000 });
  const bytes = await download(page, "report-cropped.pdf");
  const pages = await boxes(bytes);
  expect(pages).toHaveLength(2);
  for (const { media, crop } of pages) {
    expect(crop).toEqual(media);
    expect(media.x).toBeCloseTo(10 * PT_PER_MM, 3);
    expect(media.y).toBeCloseTo(10 * PT_PER_MM, 3);
    expect(media.width / PT_PER_MM).toBeCloseTo(595 / PT_PER_MM - 20, 3);
    expect(media.height / PT_PER_MM).toBeCloseTo(842 / PT_PER_MM - 30, 3);
  }
  // Cropping hides; it does not delete: the text of every page is still in the file.
  expect(await pdfTexts(bytes)).toEqual(["Page 1", "Page 2"]);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("cuts a turned page on the sides as they are seen", async ({ page }) => {
  await openTool(page, PATH);
  // Stored 400 × 300 points and turned 90° clockwise, so it is seen 300 wide and 400 tall.
  await file(page).setInputFiles(makeTestPdf("turned.pdf", 1, { size: [400, 300], rotate: 90 }));
  await expect(page.locator("#crop-pdf-original")).toHaveText(
    "turned.pdf: 1 page, first page 105.8 mm × 141.1 mm",
    { timeout: 30_000 },
  );
  await setMargins(page, "10", "", "", "");
  await page.getByRole("button", { name: "Crop", exact: true }).click();
  await expect(result(page)).toBeVisible({ timeout: 30_000 });
  const [only] = await boxes(await download(page, "turned-cropped.pdf"));
  // The top as seen is the left of the stored box.
  expect(only?.media.x).toBeCloseTo(10 * PT_PER_MM, 3);
  expect(only?.media.y).toBe(0);
  expect(only?.media.width).toBeCloseTo(400 - 10 * PT_PER_MM, 3);
  expect(only?.media.height).toBe(300);
});

test("moves the outline with the arrow keys", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(A4);
  await expect(page.locator("#crop-pdf-original")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Area to keep" }).focus();
  await page.keyboard.press("ArrowRight");
  // One step is 1% of the page width: 5.95 points, 2.1 mm.
  await expect(page.locator("#crop-pdf-left")).toHaveValue("12.1");
  await expect(page.locator("#crop-pdf-right")).toHaveValue("7.9");
  await expect(page.locator("#crop-pdf-top")).toHaveValue("10");
});

test("refuses margins that leave nothing, and a protected PDF", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(A4);
  await expect(page.locator("#crop-pdf-original")).toBeVisible({ timeout: 30_000 });
  await setMargins(page, "150", "", "150", "");
  await page.getByRole("button", { name: "Crop", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "These margins leave nothing of page 1. Make them smaller: at least 10 points (about 3.5 mm) must remain each way.",
    { timeout: 30_000 },
  );
  await expect(result(page)).toHaveCount(0);
  await file(page).setInputFiles(makeTestPdf("locked.pdf", 1, { encrypted: true }));
  await expect(
    page.getByText(
      "locked.pdf: This PDF is protected with a password. Remove the password in the program that made it, then try again.",
    ),
  ).toBeVisible({ timeout: 30_000 });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(A4);
    await expect(page.locator("#crop-pdf-original")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Crop", exact: true }).click();
    await expect(result(page)).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
