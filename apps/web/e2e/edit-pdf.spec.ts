import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFString,
} from "../../../tools/node_modules/pdf-lib/cjs/index.js";
import manifest from "../../../tools/pdf/edit-pdf/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { recordPath } from "./media";
import { makeTestPng, padTo } from "./support/test-image";
import { makeTestPdf, pdfImageCounts, pdfPages, pdfTexts } from "./support/test-pdf";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Edit PDF against `wrangler dev` (real CSP and headers). PDF.js draws each page in the tool's
// worker and pdf-lib saves the edits; every saved PDF is read back here with pdf-lib and PDF.js.
// The test PDFs are written at run time (support/test-pdf.ts); the form and link PDF is made here
// with pdf-lib. What the page says about white boxes, forms and links is what these tests show.

test.use({ baseURL: edgeURL });
test.setTimeout(120_000);

const PATH = "/edit-pdf/";
const pdfInput = (page: Page) => page.locator("#edit-pdf-file");
const sheet = (page: Page) => page.locator("#edit-pdf-page");

async function openPdf(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await pdfInput(page).setInputFiles(file);
  await expect(page.locator("#edit-pdf-pages")).toContainText("Page 1 of", { timeout: 60_000 });
  await expect(sheet(page).locator("img")).toBeVisible({ timeout: 60_000 });
}

async function addText(page: Page, text: string) {
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await page.locator("#edit-pdf-text").fill(text);
}

async function save(page: Page, name: string): Promise<Buffer> {
  await page.getByRole("button", { name: "Save PDF", exact: true }).click();
  const button = page.getByRole("button", { name: `Download ${name}` });
  await expect(button).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toBe(name);
  return readFileSync((await download.path()) ?? "");
}

/** A one page PDF with a filled text field and a link, made with pdf-lib. */
async function formAndLinkPdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 400]);
  const field = document.getForm().createTextField("name");
  field.setText("Alice");
  field.addToPage(page, { x: 50, y: 300, width: 200, height: 30 });
  const link = document.context.register(
    document.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [50, 200, 250, 230],
      Border: [0, 0, 0],
      A: { S: "URI", URI: PDFString.of("https://example.com/") },
    }),
  );
  page.node.addAnnot(link);
  return {
    name: "form.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await document.save()),
  };
}

test("adds text, a picture, a highlight, a white box and a drawing, and saves them", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  const picture = await makeTestPng(page, "stamp.png", { width: 200, height: 100 });
  await openPdf(page, makeTestPdf("report.pdf", 2));
  await expect(page.locator("#edit-pdf-notice")).toContainText("it is not redaction");

  await addText(page, "Approved");
  await expect(page.getByRole("button", { name: "Text: Approved" })).toBeVisible();
  await page.getByRole("button", { name: "Add white box", exact: true }).click();
  await page.getByRole("button", { name: "Add highlight", exact: true }).click();
  await page.locator("#edit-pdf-picture").setInputFiles(picture);
  await expect(page.getByRole("button", { name: "Picture", exact: true })).toBeVisible();

  // A stroke drawn with the mouse across the page.
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  // The mouse does not scroll: bring the top of the page into view and draw near it.
  await sheet(page).evaluate((element) => element.scrollIntoView({ block: "start" }));
  const box = await sheet(page).boundingBox();
  if (!box) throw new Error("no page");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Stop drawing", exact: true }).click();
  await expect(page.getByRole("button", { name: "Drawing", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator("#edit-pdf-pages")).toContainText("Page 2 of 2");
  await addText(page, "Second page note");

  const bytes = await save(page, "report-edited.pdf");
  const texts = await pdfTexts(bytes);
  expect(texts[0]).toContain("Approved");
  // The white box covers "Page 1" on screen, but the text is still in the file.
  expect(texts[0]).toContain("Page 1");
  expect(texts[1]).toContain("Second page note");
  expect(await pdfImageCounts(bytes)).toEqual([1, 0]);
  expect(await pdfPages(bytes)).toEqual([
    { width: 300, height: 400, rotation: 0 },
    { width: 300, height: 400, rotation: 0 },
  ]);
  recordPath(testInfo, "edit two pages and read the saved PDF back", "real");
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("places text upright on a turned page and keeps the turn", async ({ page }, testInfo) => {
  await openTool(page, PATH);
  await openPdf(page, makeTestPdf("turned.pdf", 1, { rotate: 90 }));
  // The page is seen turned: wider than tall.
  const box = await sheet(page).boundingBox();
  expect((box?.width ?? 0) > (box?.height ?? 0)).toBe(true);
  await addText(page, "Upright");
  const bytes = await save(page, "turned-edited.pdf");
  expect((await pdfPages(bytes))[0]?.rotation).toBe(90);
  expect((await pdfTexts(bytes))[0]).toContain("Upright");
  // Text drawn turned 90 degrees in the page's own space runs up the page: [0, 1, -1, 0]. A viewer
  // turns the page 90 degrees clockwise, which makes that run left to right, upright.
  const pdfjs = await import("../../../tools/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  try {
    const document = await task.promise;
    const content = await (await document.getPage(1)).getTextContent();
    const added = content.items.find((item) => "str" in item && item.str === "Upright");
    const [a, b] = added && "transform" in added ? (added.transform as number[]) : [];
    expect(Math.abs(a ?? 1)).toBeLessThan(1e-6);
    expect(b).toBeGreaterThan(0);
  } finally {
    await task.destroy();
  }
  recordPath(testInfo, "text on a page turned 90 degrees", "real");
});

test("keeps form fields with their values, and links, when it saves", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  await openPdf(page, await formAndLinkPdf());
  await addText(page, "Checked");
  await page.getByRole("button", { name: "Add white box", exact: true }).click();
  const bytes = await save(page, "form-edited.pdf");
  const document = await PDFDocument.load(bytes);
  expect(document.getForm().getTextField("name").getText()).toBe("Alice");
  const annots = (document.getPage(0).node.Annots()?.asArray() ?? []).map((ref) =>
    document.context.lookup(ref, PDFDict),
  );
  const subtype = (annot: PDFDict) => String(annot.get(PDFName.of("Subtype")));
  expect(annots.map(subtype).sort()).toEqual(["/Link", "/Widget"]);
  const link = annots.find((annot) => subtype(annot) === "/Link");
  const action = link?.lookup(PDFName.of("A"), PDFDict);
  expect(String(action?.get(PDFName.of("URI")))).toBe("(https://example.com/)");
  recordPath(testInfo, "form field and link kept", "real");
});

test("names the characters the standard fonts cannot draw, and will not save them", async ({
  page,
}) => {
  recordPath(test.info(), "undrawable characters refused", "message");
  await openTool(page, PATH);
  await openPdf(page, makeTestPdf("letter.pdf", 1));
  await addText(page, "Hello 你好 🙂");
  await expect(page.locator("#edit-pdf-problems")).toContainText(
    "Page 1: The standard PDF fonts cannot draw these characters: 你 好 🙂. Remove them to save.",
  );
  await expect(page.getByRole("button", { name: "Save PDF", exact: true })).toBeDisabled();
  await page.locator("#edit-pdf-text").fill("Hello, café");
  await expect(page.locator("#edit-pdf-problems")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save PDF", exact: true })).toBeEnabled();
});

test("moves an item with the arrow keys and removes it with Delete", async ({ page }) => {
  recordPath(test.info(), "keyboard moving", "message");
  await openTool(page, PATH);
  await openPdf(page, makeTestPdf("keys.pdf", 1));
  await addText(page, "Move me");
  const item = page.getByRole("button", { name: "Text: Move me" });
  await item.focus();
  await expect(item).toHaveAttribute("style", /left: 10%; top: 10%/);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(item).toHaveAttribute("style", /left: 11%; top: 20%/);
  await page.keyboard.press("Delete");
  await expect(item).toHaveCount(0);
});

test("opens 100 pages and refuses 101, and previews a huge page at 1,600 pixels", async ({
  page,
}) => {
  recordPath(test.info(), "page limit and preview size", "message");
  await openTool(page, PATH);
  await openPdf(page, makeTestPdf("hundred.pdf", 100));
  await expect(page.locator("#edit-pdf-pages")).toContainText("Page 1 of 100");
  await pdfInput(page).setInputFiles(makeTestPdf("more.pdf", 101));
  await expect(page.getByRole("status")).toContainText(
    "more.pdf: This PDF has 101 pages. Edit PDF opens PDFs of up to 100 pages",
    { timeout: 60_000 },
  );
  await openPdf(page, makeTestPdf("poster.pdf", 1, { size: [14400, 7200] }));
  const size = await sheet(page)
    .locator("img")
    .evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight]);
  expect(size).toEqual([1600, 800]);
});

test("refuses an encrypted PDF, a file that is not a PDF, and a picture over 5 MB", async ({
  page,
}) => {
  recordPath(test.info(), "refusals", "message");
  await openTool(page, PATH);
  await pdfInput(page).setInputFiles(makeTestPdf("locked.pdf", 1, { encrypted: true }));
  await expect(page.getByRole("status")).toContainText(
    "locked.pdf: This PDF is protected with a password or encryption, so it cannot be edited here.",
    { timeout: 60_000 },
  );
  await pdfInput(page).setInputFiles(makeTestPdf("owner.pdf", 1, { ownerPassword: "owner-only" }));
  await expect(page.getByRole("status")).toContainText(
    "owner.pdf: This PDF is protected with a password or encryption",
    { timeout: 60_000 },
  );
  await pdfInput(page).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("text"),
  });
  await expect(page.getByRole("status")).toContainText("notes.txt: This file is not a PDF.");

  await openPdf(page, makeTestPdf("photo.pdf", 1));
  const picture = await makeTestPng(page, "big.png", { width: 300, height: 200 });
  await page.locator("#edit-pdf-picture").setInputFiles(padTo(picture, 5 * 1024 * 1024 + 1));
  await expect(page.getByText("big.png: This picture is larger than 5 MB.")).toBeVisible();
  await page.locator("#edit-pdf-picture").setInputFiles(padTo(picture, 5 * 1024 * 1024));
  await expect(page.getByRole("button", { name: "Picture", exact: true })).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`has no axe violations with items on the page, ${theme} theme`, async ({ page }) => {
    recordPath(test.info(), `axe, ${theme} theme`, "message");
    await useTheme(page, theme);
    await openTool(page, PATH);
    await openPdf(page, makeTestPdf("axe.pdf", 2));
    await addText(page, "Checked");
    await page.getByRole("button", { name: "Add highlight", exact: true }).click();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts come from the manifest", async ({ page }) => {
  recordPath(test.info(), "structured data and Quick facts", "message");
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
  await expect(page.getByRole("region", { name: "Quick facts" })).toContainText("Up to 50 MB");
});
