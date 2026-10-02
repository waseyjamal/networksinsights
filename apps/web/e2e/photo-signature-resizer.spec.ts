import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/image/photo-signature-resizer/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { makeTestPng, padTo } from "./support/test-image";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Photo and Signature Resizer against `wrangler dev` (real CSP and headers): the exact pixels and
// the KB limit its page quotes, the honest refusal when the KB cannot be met, the settings limits,
// and the 25 MB file limit at and over the edge.

test.use({ baseURL: edgeURL });

const PATH = "/photo-signature-resizer/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const file = (page: Page) => page.locator("#psr-file");
const result = (page: Page) => page.locator(".ni-fileresult");

async function settings(page: Page, width: string, height: string, kb: string) {
  await page.locator("#psr-width").fill(width);
  await page.locator("#psr-height").fill(height);
  await page.locator("#psr-kb").fill(kb);
  await page.getByRole("button", { name: "Make the file" }).click();
}

test("makes a 200 by 230 JPG under 20 KB, as the page example says", async ({
  page,
  browserName,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(await makeTestPng(page, "passport.png"));
  await settings(page, "200", "230", "20");

  await expect(result(page)).toContainText("passport-200x230.jpg", { timeout: 30_000 });
  await expect(result(page)).toContainText("200 × 230 pixels");
  await expect(result(page)).toContainText("Under 20 KB");
  const size = await result(page)
    .locator("img")
    .evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    });
  expect(size).toEqual([200, 230]);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download passport-200x230.jpg" }).click(),
  ]);
  const bytes = readFileSync((await download.path()) ?? "");
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  expect(bytes.length).toBeLessThanOrEqual(20_000);
  console.log(`photo-signature-resizer ${browserName}: 200x230 under 20 KB -> ${bytes.length} B`);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("says honestly when the KB cannot be met, and makes no file", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(await makeTestPng(page, "photo.png"));
  await settings(page, "4000", "4000", "1");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("A 4000 by 4000 pixel JPG cannot be made under 1 KB", {
    timeout: 60_000,
  });
  await expect(alert).toContainText("Allow more KB or choose fewer pixels.");
  await expect(result(page)).toHaveCount(0);
});

test("refuses sizes outside 1 to 4000 pixels and 1 to 5000 KB", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(await makeTestPng(page, "photo.png"));
  await settings(page, "4001", "100", "50");
  await expect(page.getByRole("alert")).toHaveText(
    "Width and height are whole numbers of pixels from 1 to 4000.",
  );
  await settings(page, "100", "100", "5001");
  await expect(page.getByRole("alert")).toHaveText(
    "The maximum size is a whole number of KB from 1 to 5000.",
  );
});

test("Fit inside keeps the whole picture with white bands", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(await makeTestPng(page, "photo.png"));
  await page.locator("#psr-fit").selectOption("pad");
  await settings(page, "200", "230", "50");
  await expect(result(page)).toContainText("Under 50 KB", { timeout: 30_000 });
  // 1,200 by 800 fitted to 200 wide is 133 high: the top rows are a white band.
  const top = await result(page)
    .locator("img")
    .evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d");
      context?.drawImage(img, 0, 0);
      return [...(context?.getImageData(100, 5, 1, 1).data ?? [])];
    });
  for (const channel of top.slice(0, 3)) expect(channel).toBeGreaterThan(240);
});

test("refuses one byte over 25 MB, and works with a picture of exactly 25 MB", async ({ page }) => {
  await openTool(page, PATH);
  const image = await makeTestPng(page, "small.png", { width: 200, height: 100 });
  await file(page).setInputFiles(padTo({ ...image, name: "over.png" }, LIMIT + 1));
  await expect(page.getByText("over.png: This file is larger than 25 MB.")).toBeVisible();
  await file(page).setInputFiles(padTo({ ...image, name: "at-limit.png" }, LIMIT));
  await expect(page.locator("#psr-original")).toContainText("at-limit.png");
  await settings(page, "100", "100", "30");
  await expect(result(page)).toContainText("100 × 100 pixels", { timeout: 60_000 });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(await makeTestPng(page, "photo.png"));
    await settings(page, "200", "230", "20");
    await expect(result(page)).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
