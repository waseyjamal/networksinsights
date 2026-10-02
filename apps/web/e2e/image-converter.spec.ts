import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/image/image-converter/tool.config";
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

// Image Converter against `wrangler dev` (real CSP and headers): a real PNG is converted in the
// worker, the JPG keeps the size and turns the transparent corner white, Safari's missing WebP
// encoder is handled, and the size limit refuses one byte over and takes a file at the limit.

test.use({ baseURL: edgeURL });

const PATH = "/image-converter/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const files = (page: Page) => page.locator("#image-converter-files");
const rows = (page: Page) => page.locator(".ni-fileresult");

/** The pixel at (x, y) of a result preview, as RGBA. */
const pixel = (page: Page, x: number, y: number) =>
  rows(page)
    .first()
    .locator("img")
    .evaluate(
      async (img: HTMLImageElement, at) => {
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const context = canvas.getContext("2d");
        context?.drawImage(img, 0, 0);
        return [...(context?.getImageData(at.x, at.y, 1, 1).data ?? [])];
      },
      { x, y },
    );

test("converts a PNG to JPG in the worker: same size, white where it was transparent", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(page.locator("#image-converter-format")).toHaveValue("jpg");
  await files(page).setInputFiles(await makeTestPng(page));

  const row = rows(page).first();
  await expect(row).toHaveAttribute("data-state", "done", { timeout: 30_000 });
  await expect(row).toContainText("1200 × 800 pixels");
  const corner = await pixel(page, 10, 10);
  for (const channel of corner.slice(0, 3)) expect(channel).toBeGreaterThan(240);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    row.getByRole("button", { name: "Download test-photo.jpg" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("test-photo.jpg");
  const bytes = readFileSync((await download.path()) ?? "");
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("PNG keeps the transparent corner, and a new format converts the list again", async ({
  page,
}) => {
  await openTool(page, PATH);
  await files(page).setInputFiles(await makeTestPng(page));
  await expect(rows(page).first()).toHaveAttribute("data-state", "done", { timeout: 30_000 });
  await page.locator("#image-converter-format").selectOption("png");
  const row = rows(page).first();
  await expect(row.getByRole("button", { name: "Download test-photo.png" })).toBeVisible({
    timeout: 30_000,
  });
  expect((await pixel(page, 10, 10))[3]).toBe(0);
});

test("switches WebP off, and says why, where the browser cannot write it", async ({ page }) => {
  // What Safari does: asked for WebP, its encoder hands back a PNG.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type?: string, quality?: number) {
      return original.call(this, type === "image/webp" ? "image/png" : type, quality);
    };
  });
  await openTool(page, PATH);
  await expect(page.locator('#image-converter-format option[value="webp"]')).toBeDisabled();
  await expect(page.getByText("This browser cannot write WebP files.")).toBeVisible();
});

test("refuses one byte over 25 MB and other types, and converts a file of exactly 25 MB", async ({
  page,
}) => {
  await openTool(page, PATH);
  const image = await makeTestPng(page, "small.png", { width: 200, height: 100 });
  await files(page).setInputFiles([
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") },
    padTo({ ...image, name: "over.png" }, LIMIT + 1),
  ]);
  const alert = page.getByRole("status").filter({ hasText: "2 files were not added" });
  await expect(alert).toContainText("notes.txt: This file is not a JPG, PNG or WebP image.");
  await expect(alert).toContainText("over.png: This file is larger than 25 MB.");
  await expect(rows(page)).toHaveCount(0);

  await files(page).setInputFiles(padTo({ ...image, name: "at-limit.png" }, LIMIT));
  const row = rows(page).first();
  await expect(row).toHaveAttribute("data-state", "done", { timeout: 60_000 });
  await expect(row).toContainText("200 × 100 pixels");
});

test("shows a clear error for a damaged image", async ({ page }) => {
  await openTool(page, PATH);
  await files(page).setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("this is not really a png"),
  });
  const row = rows(page).first();
  await expect(row).toHaveAttribute("data-state", "error", { timeout: 30_000 });
  await expect(row).toContainText("The browser could not read this image. It may be damaged.");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await files(page).setInputFiles(await makeTestPng(page));
    await expect(rows(page).first()).toHaveAttribute("data-state", "done", { timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
