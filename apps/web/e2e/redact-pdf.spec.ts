import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  PDFDocument,
  PDFName,
  StandardFonts,
} from "../../../tools/node_modules/pdf-lib/cjs/index.js";
import manifest from "../../../tools/pdf/redact-pdf/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { makeTestPdf, pdfTexts, type TestPdf } from "./support/test-pdf";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Redact PDF against `wrangler dev` (real CSP and headers). A three-page PDF with a title, an author
// and an attached file is made here with pdf-lib; a box is dragged over the words on page 2. The
// result is read in Node with PDF.js and pdf-lib: page 2 must have no text left, pages 1 and 3 their
// own, and the properties and attachments must be as the page says.

test.use({ baseURL: edgeURL });
test.setTimeout(180_000);

const PATH = "/redact-pdf/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const file = (page: Page) => page.locator("#redact-pdf-file");
const result = (page: Page) => page.getByRole("list", { name: "Redacted PDF" }).locator("li");

async function secretPdf(): Promise<TestPdf> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 3; n++) {
    document.addPage([400, 400]).drawText(`Secret ${n}`, { x: 100, y: 190, size: 36, font });
  }
  document.setTitle("Quarterly report");
  document.setAuthor("Test Author");
  await document.attach(Buffer.from("attached notes"), "notes.txt", { mimeType: "text/plain" });
  return {
    name: "report.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await document.save()),
  };
}

/** Whether a PDF has a Names dictionary, where pdf-lib keeps attached files. */
const namesOf = async (bytes: Buffer) =>
  (await PDFDocument.load(bytes)).catalog.lookup(PDFName.of("Names")) !== undefined;

/** Drags a box across the page from (x1, y1) to (x2, y2), as fractions of the page. */
async function drag(page: Page, x1: number, y1: number, x2: number, y2: number) {
  const canvas = page.locator("#redact-pdf-canvas");
  await canvas.evaluate((element) => element.scrollIntoView({ block: "start" }));
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the page is not shown");
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x2, box.y + box.height * y2, { steps: 6 });
  await page.mouse.up();
}

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

test("removes the covered text from page 2 and keeps pages 1 and 3 as they were", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  const source = await secretPdf();
  expect(await pdfTexts(source.buffer)).toEqual(["Secret 1", "Secret 2", "Secret 3"]);
  expect(await namesOf(source.buffer)).toBe(true);
  await openTool(page, PATH);
  await expect(page.getByText("Real redaction")).toBeVisible();
  await file(page).setInputFiles(source);
  await expect(page.locator("#redact-pdf-original")).toContainText("report.pdf: 3 pages", {
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Redact" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Draw at least one box over what you want to hide.",
  );
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.locator("#redact-pdf-page")).toHaveText("Page 2 of 3", { timeout: 60_000 });
  // The words sit from 100 to about 260 points across and 190 to 216 up, on a 400-point page.
  await drag(page, 0.2, 0.4, 0.75, 0.6);
  await expect(page.locator("#redact-pdf-summary")).toHaveText("1 box on page 2.");
  await page.getByRole("button", { name: "Redact" }).click();
  await expect(result(page)).toContainText("3 pages, 1 redacted (2)", { timeout: 60_000 });
  const bytes = await download(page, "report-redacted.pdf");
  expect(await pdfTexts(bytes)).toEqual(["Secret 1", "", "Secret 3"]);
  const output = await PDFDocument.load(bytes);
  expect(output.getTitle()).toBe("Quarterly report");
  expect(output.getAuthor()).toBe("Test Author");
  expect(await namesOf(bytes)).toBe(false);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("takes 50 boxes on a page and refuses a 51st; a box can be moved and removed", async ({
  page,
}) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("one.pdf", 1));
  await expect(page.locator("#redact-pdf-original")).toContainText("one.pdf: 1 page", {
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Add a box" }).click();
  const first = page.getByRole("button", { name: "Black box 1 on page 1" });
  await first.press("ArrowRight");
  await page.getByRole("button", { name: "Remove selected box" }).click();
  await expect(page.locator("#redact-pdf-summary")).toHaveText("No boxes yet.");
  // Boxes 1 to 49 in one go, then the 50th and the 51st by real clicks.
  await page.evaluate(() => {
    const add = [...document.querySelectorAll("button")].find(
      (element) => element.textContent === "Add a box",
    );
    for (let i = 0; i < 49; i++) add?.click();
  });
  await expect(page.locator("#redact-pdf-summary")).toHaveText("49 boxes on page 1.");
  await page.getByRole("button", { name: "Add a box" }).click();
  await page.getByRole("button", { name: "Redact" }).click();
  await expect(result(page)).toContainText("1 page, 1 redacted (1)", {
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Add a box" }).click();
  await page.getByRole("button", { name: "Redact" }).click();
  await expect(page.getByRole("alert")).toHaveText("A page can have up to 50 boxes.");
});

test("refuses a protected PDF, 101 pages and one byte over 50 MB; opens 100 pages and 50 MB", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("locked.pdf", 1, { encrypted: true }));
  await expect(page.getByText("locked.pdf: This PDF is protected with a password")).toBeVisible({
    timeout: 60_000,
  });
  await file(page).setInputFiles(makeTestPdf("long.pdf", 101));
  await expect(
    page.getByText("long.pdf: This PDF has 101 pages. Redact PDF opens PDFs of up to 100 pages"),
  ).toBeVisible({ timeout: 60_000 });
  await file(page).setInputFiles(makeTestPdf("hundred.pdf", 100));
  await expect(page.locator("#redact-pdf-original")).toContainText("hundred.pdf: 100 pages", {
    timeout: 60_000,
  });
  const over = testInfo.outputPath("over.pdf");
  writeFileSync(over, makeTestPdf("over.pdf", 1, { padding: LIMIT + 1 }).buffer);
  await file(page).setInputFiles(over);
  await expect(page.getByText("over.pdf: This file is larger than 50 MB.")).toBeVisible();
  const atLimit = testInfo.outputPath("big.pdf");
  writeFileSync(atLimit, makeTestPdf("big.pdf", 2, { padding: LIMIT }).buffer);
  await file(page).setInputFiles(atLimit);
  await expect(page.locator("#redact-pdf-original")).toContainText("big.pdf: 2 pages, 50 MB", {
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Add a box" }).click();
  await page.getByRole("button", { name: "Redact" }).click();
  const bytes = await download(page, "big-redacted.pdf");
  expect((await pdfTexts(bytes))[1]).toBe("Page 2");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a box and a result, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(makeTestPdf("one.pdf", 1));
    await expect(page.locator("#redact-pdf-original")).toContainText("one.pdf", {
      timeout: 60_000,
    });
    await page.getByRole("button", { name: "Add a box" }).click();
    await page.getByRole("button", { name: "Redact" }).click();
    await expect(result(page)).toBeVisible({ timeout: 60_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
