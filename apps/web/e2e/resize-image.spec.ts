import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/image/resize-image/tool.config";
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

// Resize Image against `wrangler dev` (real CSP and headers): the sizes its page quotes, both
// modes, the new-size limit, and the 25 MB file limit at and over the edge.

test.use({ baseURL: edgeURL });

const PATH = "/resize-image/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const file = (page: Page) => page.locator("#resize-image-file");
const result = (page: Page) => page.locator(".ni-fileresult");

/** The decoded size of the result preview. */
const previewSize = (page: Page) =>
  result(page)
    .locator("img")
    .evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    });

test("resizes to a width with proportions kept, as the page example says, and downloads", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(await makeTestPng(page, "photo.png"));
  await expect(page.locator("#resize-image-original")).toContainText("1200 × 800 pixels");

  await page.locator("#resize-image-width").fill("600");
  await expect(page.locator("#resize-image-height")).toHaveValue("400");
  await page.getByRole("button", { name: "Resize" }).click();
  await expect(result(page)).toContainText("photo-600x400.png");
  await expect(result(page)).toContainText("600 × 400 pixels");
  expect(await previewSize(page)).toEqual([600, 400]);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download photo-600x400.png" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("photo-600x400.png");
  const bytes = readFileSync((await download.path()) ?? "");
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("resizes by 33 percent to 396 by 264, and takes two exact sides with proportions off", async ({
  page,
}) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(await makeTestPng(page, "photo.png"));
  await page.locator("#resize-image-mode").selectOption("percent");
  await page.locator("#resize-image-percent").fill("33");
  await page.getByRole("button", { name: "Resize" }).click();
  await expect(result(page)).toContainText("396 × 264 pixels");
  expect(await previewSize(page)).toEqual([396, 264]);

  await page.locator("#resize-image-mode").selectOption("pixels");
  await page.getByRole("switch", { name: "Keep proportions" }).uncheck();
  await page.locator("#resize-image-width").fill("500");
  await page.locator("#resize-image-height").fill("500");
  await page.getByRole("button", { name: "Resize" }).click();
  await expect(result(page)).toContainText("500 × 500 pixels");
});

test("refuses a new size over 16,384 pixels a side, and a percentage out of range", async ({
  page,
}) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(await makeTestPng(page, "photo.png"));
  await page.getByRole("switch", { name: "Keep proportions" }).uncheck();
  await page.locator("#resize-image-width").fill("16385");
  await page.locator("#resize-image-height").fill("1");
  await page.getByRole("button", { name: "Resize" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "The new size is too large: at most 16,384 pixels a side and 50 megapixels in all.",
  );
  await page.locator("#resize-image-mode").selectOption("percent");
  await page.locator("#resize-image-percent").fill("0");
  await page.getByRole("button", { name: "Resize" }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter a percentage from 1 to 1000.");
  await expect(result(page)).toHaveCount(0);
});

test("refuses one byte over 25 MB, and opens a picture of exactly 25 MB", async ({ page }) => {
  await openTool(page, PATH);
  const image = await makeTestPng(page, "small.png", { width: 200, height: 100 });
  await file(page).setInputFiles(padTo({ ...image, name: "over.png" }, LIMIT + 1));
  await expect(page.getByText("over.png: This file is larger than 25 MB.")).toBeVisible();
  await expect(page.locator("#resize-image-original")).toHaveCount(0);

  await file(page).setInputFiles(padTo({ ...image, name: "at-limit.png" }, LIMIT));
  await expect(page.locator("#resize-image-original")).toContainText("200 × 100 pixels");
  await page.locator("#resize-image-width").fill("100");
  await page.getByRole("button", { name: "Resize" }).click();
  await expect(result(page)).toContainText("100 × 50 pixels");
});

test("refuses a damaged picture with a clear message", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a png"),
  });
  await expect(
    page.getByText("broken.png: The browser could not read this image. It may be damaged."),
  ).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(await makeTestPng(page, "photo.png"));
    await page.locator("#resize-image-width").fill("300");
    await page.getByRole("button", { name: "Resize" }).click();
    await expect(result(page)).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
