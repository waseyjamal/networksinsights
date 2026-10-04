import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { LANGUAGES } from "../../../tools/image/ocr/logic";
import manifest from "../../../tools/image/ocr/tool.config";
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

// OCR image to text against `wrangler dev` (real CSP and headers): the tool's worker starts
// Tesseract's own worker from /vendor/tesseract/, which loads the engine and the chosen language
// data from this site, and reads real printed English and Hindi (e2e/fixtures/README.md) and the
// pages of a PDF drawn by PDF.js. Only the chosen language files are requested, and nothing is
// requested from another origin. Also: the 20 MB and 20-page limits, at and over the edge.

test.use({ baseURL: edgeURL });
test.setTimeout(240_000);

const PATH = "/ocr/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const png = (name: string, buffer: Buffer) => ({ name, mimeType: "image/png", buffer });
const file = (page: Page) => page.locator("#ocr-file");
const output = (page: Page) => page.locator("#ocr-text");

/** Every request the page and its workers make, by path, and any to another origin. */
function watchRequests(page: Page) {
  const paths: string[] = [];
  const foreign: string[] = [];
  page.context().on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === new URL(edgeURL).origin) paths.push(url.pathname);
    else if (url.protocol.startsWith("http")) foreign.push(request.url());
  });
  return { paths, foreign };
}

async function read(page: Page) {
  await page.getByRole("button", { name: "Read text" }).click();
  await expect(output(page)).toBeVisible({ timeout: 180_000 });
  return output(page).inputValue();
}

test("reads printed English from a photo, with files from this site only", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  const requests = watchRequests(page);
  await openTool(page, PATH);
  await expect(page.locator("#ocr-language")).toHaveValue("eng");
  await expect(page.locator("#ocr-download")).toHaveText(
    "This choice downloads up to 6.3 MB the first time.",
  );
  await file(page).setInputFiles(png("notice.png", fixture("ocr-english.png")));
  const text = await read(page);
  console.log(`ocr english: ${JSON.stringify(text)}`);
  expect(text).toContain("quick brown fox");
  expect(text).toContain("lazy dog");

  // Only English was chosen: the Hindi data was never requested.
  expect(requests.paths).toContain("/vendor/tesseract/7.0.0/lang/eng.traineddata.gz");
  expect(requests.paths.some((path) => path.includes("hin.traineddata"))).toBe(false);
  expect(requests.paths.some((path) => /tesseract-core(-simd)?\.wasm$/.test(path))).toBe(true);
  expect(requests.foreign).toEqual([]);

  // Copy and Download .txt give the same text.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download .txt" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("notice.txt");
  expect(readFileSync((await download.path()) ?? "", "utf8")).toBe(text);
  await page.getByRole("button", { name: "Copy text" }).click();
  await expect(page.getByText(/copied to the clipboard|did not allow copying/)).toBeVisible();

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("reads printed Hindi, downloading only the Hindi data", async ({ page }) => {
  const errors = collectErrors(page);
  const requests = watchRequests(page);
  await openTool(page, PATH);
  await page.locator("#ocr-language").selectOption("hin");
  await file(page).setInputFiles(png("hindi.png", fixture("ocr-hindi.png")));
  const text = await read(page);
  console.log(`ocr hindi: ${JSON.stringify(text)}`);
  expect(text).toContain("भारत");
  expect(requests.paths).toContain("/vendor/tesseract/7.0.0/lang/hin.traineddata.gz");
  expect(requests.paths.some((path) => path.includes("eng.traineddata"))).toBe(false);
  expect(errors).toEqual([]);
});

test("English and Hindi downloads both files and states their real size", async ({ page }) => {
  const requests = watchRequests(page);
  await openTool(page, PATH);
  await page.locator("#ocr-language").selectOption("both");
  await expect(page.locator("#ocr-download")).toHaveText(
    "This choice downloads up to 7.6 MB the first time.",
  );
  await expect(
    page.locator("astro-island").getByText(/English 2\.8 MB, Hindi 1\.3 MB/),
  ).toBeVisible();
  await file(page).setInputFiles(png("mixed.png", fixture("ocr-hindi.png")));
  await read(page);
  expect(requests.paths).toContain("/vendor/tesseract/7.0.0/lang/eng.traineddata.gz");
  expect(requests.paths).toContain("/vendor/tesseract/7.0.0/lang/hin.traineddata.gz");
  // The sizes stated are the bytes this site serves.
  for (const language of ["eng", "hin"] as const) {
    const response = await page.request.get(
      `/vendor/tesseract/7.0.0/lang/${language}.traineddata.gz`,
    );
    expect((await response.body()).length).toBe(LANGUAGES[language].bytes);
  }
});

test("reads every page of a PDF, and refuses one of 21 pages", async ({ page }) => {
  const errors = collectErrors(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(
    makeTestPdf("letter.pdf", 2, { size: [400, 200], label: "Sheet" }),
  );
  const text = await read(page);
  console.log(`ocr pdf: ${JSON.stringify(text)}`);
  expect(text).toBe("Page 1\n\nSheet 1\n\nPage 2\n\nSheet 2");

  await file(page).setInputFiles(makeTestPdf("long.pdf", 21, { size: [400, 200] }));
  await page.getByRole("button", { name: "Read text" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This PDF has 21 pages. Up to 20 pages can be read at a time: split it first, for example with Split PDF.",
    { timeout: 60_000 },
  );
  expect(errors).toEqual([]);
});

test("reads a PDF of exactly 20 pages", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(
    makeTestPdf("twenty.pdf", 20, { size: [300, 120], label: "Sheet" }),
  );
  const text = await read(page);
  expect(text.match(/^Page \d+$/gm)).toHaveLength(20);
  expect(text).toContain("Page 20\n\nSheet 20");
});

test("refuses a file one byte over 20 MB, and reads one of exactly 20 MB", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const over = testInfo.outputPath("over.pdf");
  writeFileSync(over, makeTestPdf("over.pdf", 1, { padding: LIMIT + 1 }).buffer);
  await file(page).setInputFiles(over);
  await expect(page.getByRole("status")).toContainText("over.pdf: This file is larger than 20 MB.");
  await expect(page.getByRole("button", { name: "Read text" })).toBeDisabled();

  const exact = testInfo.outputPath("exact.pdf");
  writeFileSync(exact, makeTestPdf("exact.pdf", 1, { padding: LIMIT, size: [400, 200] }).buffer);
  await file(page).setInputFiles(exact);
  const text = await read(page);
  expect(text).toContain("Page 1");
});

test("scales a photo over 4,000 pixels down and still reads it", async ({ page }) => {
  await openTool(page, PATH);
  // The English fixture drawn on a 5,000 pixel wide white picture, in the browser under test.
  const wide = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 5000;
    canvas.height = 400;
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 5000, 400);
    context.drawImage(image, 0, 0, image.width * 2, image.height * 2);
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  }, fixture("ocr-english.png").toString("base64"));
  await file(page).setInputFiles(png("wide.png", Buffer.from(wide, "base64")));
  const text = await read(page);
  expect(text).toContain("quick brown fox");
});

test("says so when there is no text, and refuses a file that is not a picture or PDF", async ({
  page,
}) => {
  await openTool(page, PATH);
  const blank = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 200;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, 300, 200);
    }
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  });
  await file(page).setInputFiles(png("blank.png", Buffer.from(blank, "base64")));
  await page.getByRole("button", { name: "Read text" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "No text was found. Try a sharper, straighter photo with more light.",
    { timeout: 180_000 },
  );

  await file(page).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("text"),
  });
  await expect(page.getByRole("status")).toContainText(
    "notes.txt: This file is not a PNG, JPG, WebP or PDF.",
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with text shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(png("notice.png", fixture("ocr-english.png")));
    await read(page);
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts are the manifest's", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
  await expect(page.getByRole("region", { name: "Quick facts" })).toContainText("Up to 20 MB");
});
