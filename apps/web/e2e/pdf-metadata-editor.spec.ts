import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { PDFDocument, PDFName } from "../../../tools/node_modules/pdf-lib/cjs/index.js";
import manifest from "../../../tools/pdf/pdf-metadata-editor/tool.config";
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

// PDF Metadata Editor against `wrangler dev` (real CSP and headers): a PDF made here with pdf-lib
// holds every Info field, both dates and a catalog XMP stream with a marker in it. The edited file
// is downloaded and read back in Node: changed, removed and untouched fields, the dates, and that
// the XMP stream is gone from the catalog and from the bytes of the file.

test.use({ baseURL: edgeURL });
test.setTimeout(120_000);

const PATH = "/pdf-metadata-editor/";
const XMP_MARKER = "xmp-marker-old-author";
const file = (page: Page) => page.locator("#pdf-metadata-editor-file");
const cell = (page: Page, table: string, field: string) =>
  page
    .locator(`#pdf-metadata-editor-${table} tr`, {
      has: page.getByRole("rowheader", { name: field, exact: true }),
    })
    .locator("td");

async function described() {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.addPage([300, 400]);
  document.setTitle("Draft v3");
  document.setAuthor("jsmith");
  document.setSubject("Quarterly numbers");
  document.setKeywords(["finance", "draft"]);
  document.setCreator("Writer 7");
  document.setProducer("Old producer 1.0");
  document.setCreationDate(new Date("2024-03-05T10:20:30Z"));
  document.setModificationDate(new Date("2024-03-06T11:00:00Z"));
  const xmp = `<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>${XMP_MARKER}</dc:creator></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const stream = document.context.stream(xmp, { Type: "Metadata", Subtype: "XML" });
  document.catalog.set(PDFName.of("Metadata"), document.context.register(stream));
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  expect(bytes.includes(XMP_MARKER)).toBe(true);
  return { name: "report.pdf", mimeType: "application/pdf", buffer: bytes };
}

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

test("changes, removes and keeps fields, and removes the XMP stream", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(await described());
  await expect(cell(page, "original", "Title")).toHaveText("Draft v3", { timeout: 30_000 });
  await expect(cell(page, "original", "Author")).toHaveText("jsmith");
  await expect(cell(page, "original", "Created")).toHaveText("2024-03-05 10:20:30 UTC");
  await expect(cell(page, "original", "XMP metadata stream")).toHaveText("Present");
  await expect(page.locator("#pdf-metadata-editor-field-title")).toHaveValue("Draft v3");

  await page.locator("#pdf-metadata-editor-field-title").fill("Annual report 2025 – Résumé 東京");
  await page.locator("#pdf-metadata-editor-field-author").fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(cell(page, "saved", "Title")).toHaveText("Annual report 2025 – Résumé 東京", {
    timeout: 30_000,
  });
  await expect(cell(page, "saved", "Author")).toHaveText("(none)");
  await expect(cell(page, "saved", "XMP metadata stream")).toHaveText("None");

  const bytes = await download(page, "report-metadata.pdf");
  const back = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(back.getTitle()).toBe("Annual report 2025 – Résumé 東京");
  expect(back.getAuthor()).toBeUndefined();
  expect(back.getSubject()).toBe("Quarterly numbers");
  expect(back.getKeywords()).toBe("finance draft");
  expect(back.getCreator()).toBe("Writer 7");
  expect(back.getProducer()).toBe("Old producer 1.0");
  expect(back.getCreationDate()?.toISOString()).toBe("2024-03-05T10:20:30.000Z");
  expect(back.getModificationDate()?.toISOString()).toBe("2024-03-06T11:00:00.000Z");
  expect(back.catalog.has(PDFName.of("Metadata"))).toBe(false);
  expect(bytes.includes(XMP_MARKER)).toBe(false);
  expect(back.getPageCount()).toBe(1);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("clears every field and both dates", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(await described());
  await expect(cell(page, "original", "Title")).toHaveText("Draft v3", { timeout: 30_000 });
  await page.getByRole("button", { name: "Clear all fields" }).click();
  await page.getByLabel("Remove the creation and modification dates").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(cell(page, "saved", "Created")).toHaveText("(none)", { timeout: 30_000 });
  const back = await PDFDocument.load(await download(page, "report-metadata.pdf"), {
    updateMetadata: false,
  });
  expect(back.getTitle()).toBeUndefined();
  expect(back.getAuthor()).toBeUndefined();
  expect(back.getSubject()).toBeUndefined();
  expect(back.getKeywords()).toBeUndefined();
  expect(back.getCreator()).toBeUndefined();
  expect(back.getProducer()).toBeUndefined();
  expect(back.getCreationDate()).toBeUndefined();
  expect(back.getModificationDate()).toBeUndefined();
});

test("fills fields in a PDF that has none, and refuses a protected PDF", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("plain.pdf", 1));
  await expect(cell(page, "original", "Title")).toHaveText("(none)", { timeout: 30_000 });
  await page.locator("#pdf-metadata-editor-field-author").fill("A. Writer");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(cell(page, "saved", "Author")).toHaveText("A. Writer", { timeout: 30_000 });
  const back = await PDFDocument.load(await download(page, "plain-metadata.pdf"), {
    updateMetadata: false,
  });
  expect(back.getAuthor()).toBe("A. Writer");

  await file(page).setInputFiles(makeTestPdf("locked.pdf", 1, { encrypted: true }));
  await expect(
    page.getByText(
      "locked.pdf: This PDF is protected with a password. Remove the password in the program that made it, then try again.",
    ),
  ).toBeVisible({ timeout: 30_000 });
});

test("says that other metadata may remain", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("plain.pdf", 1));
  await expect(page.getByText("Other metadata, such as XMP attached to pages")).toBeVisible({
    timeout: 30_000,
  });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(await described());
    await expect(cell(page, "original", "Title")).toHaveText("Draft v3", { timeout: 30_000 });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(cell(page, "saved", "Title")).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
