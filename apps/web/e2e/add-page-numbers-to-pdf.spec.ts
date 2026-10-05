import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/pdf/add-page-numbers-to-pdf/tool.config";
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

// Add Page Numbers to PDF against `wrangler dev` (real CSP and headers): pdf-lib, in the tool's
// worker, draws the numbers; each result is read back with PDF.js, which gives the text of every
// page with its position, size and angle. Also: the formats, the corners, a turned page, the
// number limits, protected and damaged PDFs, and the 50 MB limit at and over the edge.

test.use({ baseURL: edgeURL });
// PDF work and 50 MB files take longer than the default 30 seconds on a slow machine.
test.setTimeout(180_000);

const PATH = "/add-page-numbers-to-pdf/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const file = (page: Page) => page.locator("#add-page-numbers-to-pdf-file");
const field = (page: Page, key: string) => page.locator(`#add-page-numbers-to-pdf-${key}`);
const result = (page: Page) => page.getByRole("list", { name: "Numbered PDF" }).locator("li");

interface Text {
  str: string;
  x: number;
  y: number;
  width: number;
  size: number;
  /** The angle of the text, counterclockwise, in degrees. */
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
              size: Math.hypot(a, b),
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

/** The text on a page that is not the test file's own "Page N" label. */
const added = (page: Text[] | undefined) => (page ?? []).filter((t) => !/^Page \d+$/.test(t.str));

async function opened(page: Page, text: string, timeout = 30_000) {
  await expect(page.locator("#add-page-numbers-to-pdf-original")).toContainText(text, { timeout });
}

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

test("numbers 1 of 8 from page 3 at the bottom centre, as the page example says", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("report.pdf", 10));
  await opened(page, "report.pdf: 10 pages");
  await field(page, "format").selectOption("of");
  await field(page, "firstPage").fill("3");
  await page.getByRole("button", { name: "Add numbers" }).click();
  await expect(result(page)).toContainText("8 pages numbered", { timeout: 30_000 });
  await expect(result(page)).toContainText("First number: 1 of 8. Last number: 8 of 8.");
  const pages = await texts(await download(page, "report-numbered.pdf"));
  expect(added(pages[0])).toEqual([]);
  expect(added(pages[1])).toEqual([]);
  const third = added(pages[2]);
  expect(third.map((t) => t.str)).toEqual(["1 of 8"]);
  expect(added(pages[9]).map((t) => t.str)).toEqual(["8 of 8"]);
  // Bottom centre of a 300 by 400 point page, 36 points up, 11 points high.
  const [number] = third;
  expect(number?.y).toBeCloseTo(36, 1);
  expect((number?.x ?? 0) + (number?.width ?? 0) / 2).toBeCloseTo(150, 0);
  expect(number?.size).toBeCloseTo(11, 1);
  expect(number?.angle).toBe(0);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("writes Page N at the top right with a 20 point font and a 10 point margin", async ({
  page,
}) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("two.pdf", 2, { label: "Sheet" }));
  await opened(page, "two.pdf: 2 pages");
  await field(page, "position").selectOption("top-right");
  await field(page, "format").selectOption("page");
  await field(page, "fontSize").fill("20");
  await field(page, "margin").fill("10");
  await page.getByRole("button", { name: "Add numbers" }).click();
  await expect(result(page)).toContainText("2 pages numbered", { timeout: 30_000 });
  const pages = await texts(await download(page, "two-numbered.pdf"));
  const number = pages[1]?.find((t) => t.str === "Page 2");
  expect(number?.size).toBeCloseTo(20, 1);
  // PDF.js measures the width with its own copy of the font metrics: within a point.
  expect(Math.abs((number?.x ?? 0) + (number?.width ?? 0) - 290)).toBeLessThan(1);
  expect(number?.y).toBeCloseTo(400 - 10 - 20 * 0.72, 1);
});

test("keeps the number upright at the bottom of a page shown turned", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("turned.pdf", 1, { rotate: 90 }));
  await opened(page, "turned.pdf: 1 page");
  await page.getByRole("button", { name: "Add numbers" }).click();
  await expect(result(page)).toContainText("1 page numbered", { timeout: 30_000 });
  const [number] = added((await texts(await download(page, "turned-numbered.pdf")))[0]);
  // Turned 90° clockwise, the bottom of the page as seen is the page's right edge (x = 300).
  expect(number?.str).toBe("1");
  expect(number?.angle).toBe(90);
  expect(number?.x).toBeCloseTo(300 - 36, 1);
});

test("numbers only the chosen pages, which still count, from a start of 0", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("five.pdf", 5));
  await opened(page, "five.pdf: 5 pages");
  await field(page, "start").fill("0");
  await field(page, "which").selectOption("chosen");
  await field(page, "pages").fill("2, 4-");
  await page.getByRole("button", { name: "Add numbers" }).click();
  await expect(result(page)).toContainText("3 pages numbered", { timeout: 30_000 });
  const pages = await texts(await download(page, "five-numbered.pdf"));
  expect(
    pages.map((p) =>
      added(p)
        .map((t) => t.str)
        .join(),
    ),
  ).toEqual(["", "1", "", "3", "4"]);
});

test("refuses numbers outside their limits", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("one.pdf", 1));
  await opened(page, "one.pdf: 1 page");
  const add = page.getByRole("button", { name: "Add numbers" });
  await field(page, "fontSize").fill("73");
  await add.click();
  await expect(page.getByRole("alert")).toHaveText(
    "The font size must be a whole number from 6 to 72 points.",
  );
  await field(page, "fontSize").fill("72");
  await field(page, "margin").fill("145");
  await add.click();
  await expect(page.getByRole("alert")).toHaveText(
    "The margin must be a whole number from 0 to 144 points.",
  );
  await field(page, "margin").fill("144");
  await field(page, "start").fill("100000");
  await add.click();
  await expect(page.getByRole("alert")).toHaveText(
    "The start number must be a whole number from 0 to 99,999.",
  );
  await field(page, "start").fill("99999");
  await field(page, "firstPage").fill("2");
  await add.click();
  await expect(page.getByRole("alert")).toHaveText(
    "The first page to number must be a whole number from 1 to 1.",
  );
  await field(page, "firstPage").fill("1");
  await add.click();
  await expect(result(page)).toContainText("Last number: 99999.", { timeout: 30_000 });
  const [number] = added((await texts(await download(page, "one-numbered.pdf")))[0]);
  expect(number?.str).toBe("99999");
  expect(number?.size).toBeCloseTo(72, 1);
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

test("refuses a PDF one byte over 50 MB, and numbers one of exactly 50 MB", async ({
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
  await page.getByRole("button", { name: "Add numbers" }).click();
  await expect(result(page)).toContainText("2 pages numbered", { timeout: 120_000 });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(makeTestPdf("report.pdf", 3));
    await opened(page, "report.pdf: 3 pages");
    await field(page, "which").selectOption("chosen");
    await field(page, "pages").fill("2-");
    await page.getByRole("button", { name: "Add numbers" }).click();
    await expect(result(page)).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
