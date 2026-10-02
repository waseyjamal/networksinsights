import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/pdf/image-to-pdf/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { makeTestJpg, makeTestPng, padTo, withExifOrientation } from "./support/test-image";
import { pdfPages } from "./support/test-pdf";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Image to PDF against `wrangler dev` (real CSP and headers): real pictures become a PDF in the
// worker, and the result is read back to check every page's size. Also: reordering, a phone
// photo's orientation, the 25 MB and 50-picture limits at and over the edge, and damaged files.

test.use({ baseURL: edgeURL });
// PDF work and 50 MB files take longer than the default 30 seconds on a slow machine.
test.setTimeout(180_000);

const PATH = "/image-to-pdf/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const files = (page: Page) => page.locator("#image-to-pdf-files");
const list = (page: Page) => page.getByRole("list", { name: "Pictures for the PDF" }).locator("li");
const result = (page: Page) => page.getByRole("list", { name: "Your PDF" }).locator("li");

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

test("a wide and a tall picture on A4 give a landscape and a portrait page, as the page says", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await files(page).setInputFiles([
    await makeTestPng(page, "wide.png", { width: 1200, height: 800 }),
    await makeTestJpg(page, "tall.jpg", { width: 800, height: 1200 }),
  ]);
  await expect(list(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Make PDF" }).click();
  await expect(result(page)).toContainText("2 pages", { timeout: 30_000 });
  const pages = await pdfPages(await download(page, "wide.pdf"));
  expect(pages.map((p) => [p.width, p.height])).toEqual([
    [842, 595],
    [595, 842],
  ]);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("Fit to each picture makes each page the picture's size; Up changes the order", async ({
  page,
}) => {
  await openTool(page, PATH);
  await files(page).setInputFiles([
    await makeTestPng(page, "wide.png", { width: 1200, height: 800 }),
    await makeTestJpg(page, "tall.jpg", { width: 800, height: 1200 }),
  ]);
  await page.getByRole("button", { name: "Move tall.jpg up" }).click();
  await expect(list(page).first()).toContainText("1. tall.jpg");
  await page.locator("#image-to-pdf-size").selectOption("fit");
  await page.locator("#image-to-pdf-margin").selectOption("0");
  await expect(page.locator("#image-to-pdf-orientation")).toBeDisabled();
  await page.getByRole("button", { name: "Make PDF" }).click();
  await expect(result(page)).toContainText("2 pages", { timeout: 30_000 });
  const pages = await pdfPages(await download(page, "tall.pdf"));
  expect(pages.map((p) => [p.width, p.height])).toEqual([
    [800, 1200],
    [1200, 800],
  ]);
});

test("a phone photo stored sideways comes out upright", async ({ page }) => {
  await openTool(page, PATH);
  // 200 by 100 pixels, tagged "turn 90° clockwise": shown as 100 by 200.
  const photo = withExifOrientation(
    await makeTestJpg(page, "phone.jpg", { width: 200, height: 100 }),
    6,
  );
  await files(page).setInputFiles(photo);
  await page.locator("#image-to-pdf-size").selectOption("fit");
  await page.locator("#image-to-pdf-margin").selectOption("0");
  await page.getByRole("button", { name: "Make PDF" }).click();
  await expect(result(page)).toContainText("1 page", { timeout: 30_000 });
  const pages = await pdfPages(await download(page, "phone.pdf"));
  expect(pages.map((p) => [p.width, p.height])).toEqual([[100, 200]]);
});

test("refuses one byte over 25 MB, takes a picture of exactly 25 MB, and refuses a 51st", async ({
  page,
}) => {
  await openTool(page, PATH);
  const small = await makeTestPng(page, "small.png", { width: 200, height: 100 });
  await files(page).setInputFiles([
    padTo({ ...small, name: "over.png" }, LIMIT + 1),
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("text") },
  ]);
  const alert = page.getByRole("status").filter({ hasText: "2 files were not added" });
  await expect(alert).toContainText("over.png: This file is larger than 25 MB.");
  await expect(alert).toContainText("notes.txt: This file is not a JPG, PNG or WebP image.");

  await files(page).setInputFiles(padTo({ ...small, name: "at-limit.png" }, LIMIT));
  const many = Array.from({ length: 50 }, (_, i) => ({ ...small, name: `p${i + 2}.png` }));
  await files(page).setInputFiles(many);
  await expect(list(page)).toHaveCount(50);
  await expect(page.getByText("p51.png: Only 50 pictures can go into one PDF.")).toBeVisible();
  await page.getByRole("button", { name: "Make PDF" }).click();
  await expect(result(page)).toContainText("50 pages", { timeout: 120_000 });
});

test("names a damaged picture when the PDF cannot be made", async ({ page }) => {
  await openTool(page, PATH);
  await files(page).setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a png"),
  });
  await page.getByRole("button", { name: "Make PDF" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "broken.png could not be read. It may be damaged.",
    {
      timeout: 30_000,
    },
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await files(page).setInputFiles(await makeTestPng(page, "wide.png"));
    await page.getByRole("button", { name: "Make PDF" }).click();
    await expect(result(page)).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
