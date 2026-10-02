import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/image/crop-image/tool.config";
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

// Crop Image against `wrangler dev` (real CSP and headers): the crops its page quotes, the result
// pixels, a rectangle outside the picture, and the 25 MB file limit at and over the edge.

test.use({ baseURL: edgeURL });

const PATH = "/crop-image/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const file = (page: Page) => page.locator("#crop-image-file");
const result = (page: Page) => page.locator(".ni-fileresult");
const value = (page: Page, key: string) => page.locator(`#crop-image-${key}`);

test("a square crop is the centred 800 by 800, as the page example says, and downloads", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(await makeTestPng(page, "photo.png"));
  await expect(page.locator("#crop-image-original")).toContainText("1200 × 800 pixels");

  await page.locator("#crop-image-ratio").selectOption("1:1");
  await expect(value(page, "x")).toHaveValue("200");
  await expect(value(page, "width")).toHaveValue("800");
  await page.getByRole("button", { name: "Crop" }).click();
  await expect(result(page)).toContainText("photo-cropped-800x800.png");

  const size = await result(page)
    .locator("img")
    .evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    });
  expect(size).toEqual([800, 800]);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download photo-cropped-800x800.png" }).click(),
  ]);
  const bytes = readFileSync((await download.path()) ?? "");
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("16:9 gives 1,200 by 675 from 62 pixels down; free crop keeps the transparent corner", async ({
  page,
}) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(await makeTestPng(page, "photo.png"));
  await page.locator("#crop-image-ratio").selectOption("16:9");
  await expect(value(page, "y")).toHaveValue("62");
  await expect(value(page, "height")).toHaveValue("675");
  // With a fixed shape the height follows the width.
  await value(page, "width").fill("320");
  await expect(value(page, "height")).toHaveValue("180");

  await page.locator("#crop-image-ratio").selectOption("free");
  await value(page, "x").fill("0");
  await value(page, "y").fill("0");
  await value(page, "width").fill("100");
  await value(page, "height").fill("50");
  await page.getByRole("button", { name: "Crop" }).click();
  await expect(result(page)).toContainText("100 × 50 pixels");
  // The test picture's top left 80 by 80 is transparent, and PNG keeps it.
  const alpha = await result(page)
    .locator("img")
    .evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d");
      context?.drawImage(img, 0, 0);
      return context?.getImageData(5, 5, 1, 1).data[3];
    });
  expect(alpha).toBe(0);
});

test("refuses a rectangle that leaves the picture, with the picture size", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(await makeTestPng(page, "photo.png"));
  await value(page, "x").fill("1");
  await page.getByRole("button", { name: "Crop" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "The crop must fit inside the picture, which is 1200 by 800 pixels.",
  );
  await expect(result(page)).toHaveCount(0);
});

test("refuses one byte over 25 MB, and crops a picture of exactly 25 MB", async ({ page }) => {
  await openTool(page, PATH);
  const image = await makeTestPng(page, "small.png", { width: 200, height: 100 });
  await file(page).setInputFiles(padTo({ ...image, name: "over.png" }, LIMIT + 1));
  await expect(page.getByText("over.png: This file is larger than 25 MB.")).toBeVisible();
  await file(page).setInputFiles(padTo({ ...image, name: "at-limit.png" }, LIMIT));
  await expect(page.locator("#crop-image-original")).toContainText("200 × 100 pixels");
  await page.locator("#crop-image-ratio").selectOption("1:1");
  await page.getByRole("button", { name: "Crop" }).click();
  await expect(result(page)).toContainText("100 × 100 pixels");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(await makeTestPng(page, "photo.png"));
    await page.getByRole("button", { name: "Crop" }).click();
    await expect(result(page)).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
