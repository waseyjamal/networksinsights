import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/pdf/compress-pdf/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { EXAMPLE_PICTURES, makePhotoPdf, type PictureSpec } from "./support/photo-pdf";
import { makeTestPdf, pdfImageCounts, pdfPages, pdfTexts, type TestPdf } from "./support/test-pdf";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Compress PDF against `wrangler dev` (real CSP and headers). PDFium, compiled to WebAssembly, is
// fetched only when Compress is pressed. Every PDF is made while the test runs: the page example
// (six 3000 by 2000 photos and a transparent picture, about 20 MB) must come out under a tenth of
// its size with the same text read back by PDF.js; a text-only PDF is not offered; protected and
// damaged PDFs are refused; and the 50 MB, 500-page and 25-megapixel limits hold at and over the
// edge.

test.use({ baseURL: edgeURL });
// Drawing 20 MB of photos and compressing them takes longer than the default 30 seconds.
test.setTimeout(300_000);

const PATH = "/compress-pdf/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const WORK = { timeout: 240_000 };

const dropzone = (page: Page) => page.locator("#compress-pdf-file");
const compress = (page: Page) => page.getByRole("button", { name: "Compress", exact: true });
const summary = (page: Page) => page.locator("#compress-pdf-summary");
const result = (page: Page) => page.getByRole("list", { name: "Compressed PDF" }).locator("li");
const failure = (page: Page) => page.getByRole("alert");

async function choose(page: Page, pdf: TestPdf, path?: string) {
  if (path) {
    writeFileSync(path, pdf.buffer);
    await dropzone(page).setInputFiles(path);
  } else {
    await dropzone(page).setInputFiles(pdf);
  }
}

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

test("compresses the page example under a tenth, keeps its text, and loads PDFium only then", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await openTool(page, PATH);
  const example = await makePhotoPdf(page, "report.pdf", EXAMPLE_PICTURES);
  // "About 20 MB", as the page says.
  expect(example.buffer.length).toBeGreaterThan(18 * 1024 * 1024);
  expect(example.buffer.length).toBeLessThan(23 * 1024 * 1024);

  await choose(page, example, testInfo.outputPath("report.pdf"));
  await expect(page.locator("#compress-pdf-original")).toContainText("report.pdf:");
  await expect(page.getByRole("combobox", { name: "Compression" })).toHaveValue("recommended");
  expect(requests.filter((url) => url.endsWith(".wasm"))).toEqual([]);

  await compress(page).click();
  await expect(summary(page)).toHaveText(
    "7 pages, 7 pictures found: 6 recompressed, 1 with transparency kept, 0 kept as they were.",
    WORK,
  );
  expect(requests.filter((url) => /\/_astro\/pdfium-[\w-]+\.wasm$/.test(url))).toHaveLength(1);
  await expect(result(page)).toContainText(/MB to .+, \d+% smaller/);

  const output = await download(page, "report-compressed.pdf");
  expect(output.length).toBeLessThan(example.buffer.length / 10);
  expect((await pdfPages(output)).length).toBe(7);
  expect(await pdfImageCounts(output)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  const before = await pdfTexts(example.buffer);
  expect(before[0]).toContain("Page 1 line 1: selectable text survives compression.");
  expect(await pdfTexts(output)).toEqual(before);

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("Strong is smaller than Recommended, which is smaller than Light, with the same text", async ({
  page,
}) => {
  await openTool(page, PATH);
  const pictures: PictureSpec[] = [
    { width: 2400, height: 1600, kind: "photo", shownWidth: 297.5 },
    { width: 2400, height: 1600, kind: "photo", shownWidth: 297.5 },
  ];
  const pdf = await makePhotoPdf(page, "two.pdf", pictures);
  await choose(page, pdf);
  const sizes: Record<string, number> = {};
  for (const level of ["light", "recommended", "strong"]) {
    await page.getByRole("combobox", { name: "Compression" }).selectOption(level);
    await compress(page).click();
    await expect(summary(page)).toContainText("2 recompressed", WORK);
    const output = await download(page, "two-compressed.pdf");
    expect(await pdfTexts(output)).toEqual(await pdfTexts(pdf.buffer));
    sizes[level] = output.length;
  }
  expect(sizes.strong).toBeLessThan(sizes.recommended ?? 0);
  expect(sizes.recommended).toBeLessThan(sizes.light ?? 0);
  expect(sizes.light).toBeLessThan(pdf.buffer.length);
});

test("offers nothing when a text-only PDF does not get smaller", async ({ page }) => {
  await openTool(page, PATH);
  await choose(page, makeTestPdf("letter.pdf", 3));
  await compress(page).click();
  await expect(summary(page)).toHaveText(
    "3 pages, 0 pictures found: 0 recompressed, 0 with transparency kept, 0 kept as they were.",
    WORK,
  );
  await expect(
    page.getByText("This PDF did not get smaller, so there is nothing to download"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Download/ })).toHaveCount(0);
});

test("refuses protected PDFs, an owner password included, and a damaged one", async ({ page }) => {
  const protectedMessage =
    "This PDF is protected with a password. Remove the password in the program that made it, then try again.";
  await openTool(page, PATH);

  await choose(page, makeTestPdf("locked.pdf", 1, { encrypted: true }));
  await compress(page).click();
  await expect(failure(page)).toHaveText(`locked.pdf: ${protectedMessage}`, WORK);

  // This one opens without a password anywhere (PDF.js reads it), but carries an owner password.
  const owner = makeTestPdf("owner.pdf", 2, { ownerPassword: "secret" });
  expect(await pdfTexts(owner.buffer)).toEqual(["Page 1", "Page 2"]);
  await choose(page, owner);
  await compress(page).click();
  await expect(failure(page)).toHaveText(`owner.pdf: ${protectedMessage}`, WORK);

  await choose(page, {
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 nothing"),
  });
  await compress(page).click();
  await expect(failure(page)).toHaveText(
    "broken.pdf: This PDF could not be read. It may be damaged or not a real PDF.",
    WORK,
  );
});

test("refuses a PDF one byte over 50 MB, and works on one of exactly 50 MB", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  await choose(
    page,
    makeTestPdf("over.pdf", 1, { padding: LIMIT + 1 }),
    testInfo.outputPath("over.pdf"),
  );
  await expect(page.getByText("over.pdf: This file is larger than 50 MB.")).toBeVisible();
  await expect(compress(page)).toHaveCount(0);

  await choose(page, makeTestPdf("big.pdf", 2, { padding: LIMIT }), testInfo.outputPath("big.pdf"));
  await compress(page).click();
  await expect(summary(page)).toHaveText(
    "2 pages, 0 pictures found: 0 recompressed, 0 with transparency kept, 0 kept as they were.",
    WORK,
  );
});

test("works on 500 pages and refuses 501", async ({ page }) => {
  await openTool(page, PATH);
  await choose(page, makeTestPdf("many.pdf", 500));
  await compress(page).click();
  await expect(summary(page)).toContainText("500 pages, 0 pictures found", WORK);

  await choose(page, makeTestPdf("more.pdf", 501));
  await compress(page).click();
  await expect(failure(page)).toHaveText(
    "more.pdf: This PDF has 501 pages. Compress PDF works on up to 500 pages.",
    WORK,
  );
});

test("recompresses a picture of exactly 25 megapixels and keeps a larger one", async ({ page }) => {
  await openTool(page, PATH);
  const at = await makePhotoPdf(
    page,
    "at.pdf",
    [{ width: 5000, height: 5000, kind: "smooth", shownWidth: 200 }],
    1,
  );
  await choose(page, at);
  await compress(page).click();
  await expect(summary(page)).toHaveText(
    "1 page, 1 picture found: 1 recompressed, 0 with transparency kept, 0 kept as they were.",
    WORK,
  );

  const over = await makePhotoPdf(
    page,
    "over.pdf",
    [{ width: 5000, height: 5001, kind: "smooth", shownWidth: 200 }],
    1,
  );
  await choose(page, over);
  await compress(page).click();
  await expect(summary(page)).toHaveText(
    "1 page, 1 picture found: 0 recompressed, 0 with transparency kept, 1 kept as they were.",
    WORK,
  );
});

test("Cancel stops the work and offers nothing", async ({ page }) => {
  await openTool(page, PATH);
  await choose(page, await makePhotoPdf(page, "report.pdf", EXAMPLE_PICTURES));
  await compress(page).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0, WORK);
  await expect(compress(page)).toBeEnabled();
  await expect(summary(page)).toHaveCount(0);
  await expect(failure(page)).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    const pdf = await makePhotoPdf(page, "one.pdf", [
      { width: 1600, height: 1200, kind: "photo", shownWidth: 297.5 },
    ]);
    await choose(page, pdf);
    await compress(page).click();
    await expect(result(page)).toBeVisible(WORK);
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
