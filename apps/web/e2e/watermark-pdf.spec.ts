import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from "../../../tools/node_modules/pdf-lib/cjs/index.js";
import manifest from "../../../tools/pdf/watermark-pdf/tool.config";
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

// Watermark PDF against `wrangler dev` (real CSP and headers): pdf-lib, in the tool's worker,
// draws the text; each result is read back with PDF.js (text, position and angle) and pdf-lib
// (opacity and colour). Also: tiling, chosen pages, the standard-font character rule, the text and
// number limits, protected and damaged PDFs, and the 50 MB limit at and over the edge.

test.use({ baseURL: edgeURL });
// PDF work and 50 MB files take longer than the default 30 seconds on a slow machine.
test.setTimeout(180_000);

const PATH = "/watermark-pdf/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const file = (page: Page) => page.locator("#watermark-pdf-file");
const field = (page: Page, key: string) => page.locator(`#watermark-pdf-${key}`);
const result = (page: Page) => page.getByRole("list", { name: "Watermarked PDF" }).locator("li");
const add = (page: Page) => page.getByRole("button", { name: "Add watermark" });

interface Text {
  str: string;
  x: number;
  y: number;
  width: number;
  angle: number;
}

/** Every piece of text on every page, with where PDF.js finds it. */
async function texts(buffer: Buffer): Promise<Text[][]> {
  const pdfjs = await import("../../../tools/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 });
  try {
    const document = await task.promise;
    const pages: Text[][] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const content = await (await document.getPage(number)).getTextContent();
      pages.push(
        content.items
          .filter((item) => "str" in item && item.str.trim() !== "")
          .map((item) => {
            const { str, transform, width } = item as {
              str: string;
              transform: number[];
              width: number;
            };
            const [a = 0, b = 0, , , e = 0, f = 0] = transform;
            return {
              str,
              x: e,
              y: f,
              width,
              angle: Math.round((Math.atan2(b, a) * 180) / Math.PI),
            };
          }),
      );
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/** The watermark copies on a page: not the test file's own "Page N" label. */
const marks = (page: Text[] | undefined) => (page ?? []).filter((t) => !/^Page \d+$/.test(t.str));

/** The fill opacities (ca) of a page's graphics states, and its decoded content streams. */
async function paint(buffer: Buffer, index: number) {
  const document = await PDFDocument.load(buffer);
  const page = document.getPage(index);
  const states = page.node.Resources()?.lookup(PDFName.of("ExtGState"));
  const opacities: number[] = [];
  if (states instanceof PDFDict) {
    for (const key of states.keys()) {
      const state = states.lookup(key);
      const ca = state instanceof PDFDict ? state.lookup(PDFName.of("ca")) : undefined;
      if (ca instanceof PDFNumber) opacities.push(ca.asNumber());
    }
  }
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  let content = "";
  for (const ref of streams) {
    const stream = document.context.lookup(ref);
    if (stream instanceof PDFRawStream) {
      content += Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
    }
  }
  return { opacities, content };
}

async function opened(page: Page, text: string, timeout = 30_000) {
  await expect(page.locator("#watermark-pdf-original")).toContainText(text, { timeout });
}

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

test("stamps CONFIDENTIAL once per page at 45 degrees, as the page example says", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("contract.pdf", 3));
  await opened(page, "contract.pdf: 3 pages");
  // The example's settings are the defaults; set them anyway so the test says what it checks.
  await field(page, "text").fill("CONFIDENTIAL");
  await field(page, "fontSize").fill("60");
  await field(page, "color").fill("#808080");
  await field(page, "opacity").fill("25");
  await field(page, "angle").fill("45");
  await field(page, "layout").selectOption("single");
  await add(page).click();
  await expect(result(page)).toContainText("3 pages watermarked, 3 copies of the text", {
    timeout: 30_000,
  });
  const saved = await download(page, "contract-watermarked.pdf");
  const pages = await texts(saved);
  for (const onPage of pages) {
    const [mark, ...rest] = marks(onPage);
    expect(rest).toEqual([]);
    expect(mark?.str).toBe("CONFIDENTIAL");
    expect(mark?.angle).toBe(45);
    // The middle of the baseline sits close to the centre of the 300 by 400 point page.
    const radians = Math.PI / 4;
    const midX = (mark?.x ?? 0) + ((mark?.width ?? 0) / 2) * Math.cos(radians);
    const midY = (mark?.y ?? 0) + ((mark?.width ?? 0) / 2) * Math.sin(radians);
    expect(Math.abs(midX - 150)).toBeLessThan(20);
    expect(Math.abs(midY - 200)).toBeLessThan(20);
  }
  const { opacities, content } = await paint(saved, 0);
  expect(opacities).toContain(0.25);
  expect(content).toMatch(/0\.50196\d* 0\.50196\d* 0\.50196\d* rg/);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("tiles red text across the chosen pages only", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("report.pdf", 3));
  await opened(page, "report.pdf: 3 pages");
  await field(page, "text").fill("DRAFT");
  await field(page, "fontSize").fill("20");
  await field(page, "color").fill("#cc0000");
  await field(page, "opacity").fill("100");
  await field(page, "angle").fill("0");
  await field(page, "layout").selectOption("tiled");
  await field(page, "which").selectOption("chosen");
  await field(page, "pages").fill("2");
  await add(page).click();
  await expect(result(page)).toContainText("1 page watermarked", { timeout: 30_000 });
  const saved = await download(page, "report-watermarked.pdf");
  const pages = await texts(saved);
  expect(marks(pages[0])).toEqual([]);
  expect(marks(pages[2])).toEqual([]);
  const tiles = marks(pages[1]);
  expect(tiles.length).toBeGreaterThan(10);
  await expect(result(page)).toContainText(`${tiles.length} copies of the text`);
  expect(new Set(tiles.map((t) => t.angle))).toEqual(new Set([0]));
  // Copies reach the bottom and the top of the page.
  expect(Math.min(...tiles.map((t) => t.y))).toBeLessThan(60);
  expect(Math.max(...tiles.map((t) => t.y))).toBeGreaterThan(340);
  const { content } = await paint(saved, 1);
  expect(content).toMatch(/0\.8 0 0 rg/);
});

test("refuses characters the standard font cannot draw, and takes Western accents", async ({
  page,
}) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("one.pdf", 1));
  await opened(page, "one.pdf: 1 page");
  await field(page, "text").fill("Price ₹100 नमस्ते");
  await add(page).click();
  await expect(page.getByRole("alert")).toHaveText(
    'The standard PDF font cannot draw "₹", "न", "म", "स", "्". Use Latin letters, digits and common punctuation.',
  );
  await field(page, "text").fill("Brouillon – Café 10 €");
  await field(page, "fontSize").fill("20");
  await add(page).click();
  await expect(result(page)).toContainText("1 copy of the text", { timeout: 30_000 });
  // PDF.js may split one line of text into several pieces: join them.
  const pieces = marks((await texts(await download(page, "one-watermarked.pdf")))[0]);
  expect(pieces.map((t) => t.str).join("")).toBe("Brouillon – Café 10 €");
});

test("takes text of 100 characters and refuses 101, and checks the number limits", async ({
  page,
}) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("one.pdf", 1, { size: [600, 400] }));
  await opened(page, "one.pdf: 1 page");
  await field(page, "text").fill("x".repeat(101));
  await add(page).click();
  await expect(page.getByRole("alert")).toHaveText("The watermark can be at most 100 characters.");
  await field(page, "text").fill("x".repeat(100));
  for (const [key, value, message] of [
    ["fontSize", "7", "The font size must be a whole number from 8 to 200 points."],
    ["fontSize", "201", "The font size must be a whole number from 8 to 200 points."],
    ["opacity", "4", "The opacity must be a whole number from 5 to 100 percent."],
    ["angle", "181", "The angle must be a whole number from -180 to 180 degrees."],
    ["color", "grey", "The colour must be a hex colour such as #808080."],
  ] as const) {
    await field(page, key).fill(value);
    await add(page).click();
    await expect(page.getByRole("alert")).toHaveText(message);
    await field(page, "fontSize").fill("8");
    await field(page, "opacity").fill("5");
    await field(page, "angle").fill("-180");
    await field(page, "color").fill("#808080");
  }
  await add(page).click();
  await expect(result(page)).toContainText("1 copy of the text", { timeout: 30_000 });
  const saved = await download(page, "one-watermarked.pdf");
  // A wide page, so all 100 characters at 8 points lie on it: PDF.js leaves out text off the page.
  const pieces = marks((await texts(saved))[0]);
  expect(pieces.map((t) => t.str).join("")).toBe("x".repeat(100));
  expect(Math.abs(pieces[0]?.angle ?? 0)).toBe(180);
  expect((await paint(saved, 0)).opacities).toContain(0.05);
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

test("refuses a PDF one byte over 50 MB, and watermarks one of exactly 50 MB", async ({
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
  await add(page).click();
  await expect(result(page)).toContainText("2 pages watermarked", { timeout: 120_000 });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(makeTestPdf("report.pdf", 2));
    await opened(page, "report.pdf: 2 pages");
    await field(page, "which").selectOption("chosen");
    await field(page, "pages").fill("1");
    await add(page).click();
    await expect(result(page)).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
