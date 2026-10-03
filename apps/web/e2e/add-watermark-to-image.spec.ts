import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/image/add-watermark-to-image/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { makeTestJpg, makeTestPng, padTo, type TestImage } from "./support/test-image";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Add Watermark to Image against `wrangler dev` (real CSP and headers): a JPG, a PNG and a WebP
// come back in their own format at their own size, with the text drawn where the page says; the
// settings refuse values over their ranges; the 25 MB limit at and over the edge; damaged files.

test.use({ baseURL: edgeURL });
test.setTimeout(120_000);

const PATH = "/add-watermark-to-image/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const input = (page: Page) => page.locator("#watermark-file");
const result = (page: Page) => page.getByRole("list", { name: "Your picture" }).locator("li");
const apply = (page: Page) => page.getByRole("button", { name: "Add watermark" });

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

/** Decodes a file in the page: its size and the average brightness of a box of it. */
async function inspect(
  page: Page,
  bytes: Buffer,
  mime: string,
  box: [number, number, number, number],
) {
  return page.evaluate(
    async ({ base64, mime, box }) => {
      const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([data], { type: mime }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(...box).data;
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        sum += ((pixels[i] ?? 0) + (pixels[i + 1] ?? 0) + (pixels[i + 2] ?? 0)) / 3;
      }
      return { width: bitmap.width, height: bitmap.height, light: sum / (pixels.length / 4) };
    },
    { base64: bytes.toString("base64"), mime, box },
  );
}

/** A plain dark grey PNG, so white text shows clearly where it is drawn. */
async function darkPng(page: Page, name: string, type = "image/png"): Promise<TestImage> {
  const base64 = await page.evaluate(async (type) => {
    const canvas = new OffscreenCanvas(400, 300);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.fillStyle = "#202020";
    context.fillRect(0, 0, 400, 300);
    const blob = await canvas.convertToBlob({ type, quality: 0.95 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, type);
  return { name, mimeType: type, buffer: Buffer.from(base64, "base64") };
}

test("a PNG gets the text bottom right, in PNG at its own size", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await input(page).setInputFiles(await darkPng(page, "dark.png"));
  await page.locator("#watermark-text").fill("WWWWWWWW");
  await page.locator("#watermark-size").fill("20");
  await page.locator("#watermark-opacity").fill("100");
  await apply(page).click();
  await expect(result(page)).toContainText("400 × 300 pixels", { timeout: 30_000 });
  const saved = await download(page, "dark-watermarked.png");
  const bottomRight = await inspect(page, saved, "image/png", [250, 230, 120, 40]);
  const topLeft = await inspect(page, saved, "image/png", [10, 10, 120, 40]);
  expect(bottomRight).toMatchObject({ width: 400, height: 300 });
  expect(bottomRight.light).toBeGreaterThan(topLeft.light + 40);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("a tiled watermark covers the corners too", async ({ page }) => {
  await openTool(page, PATH);
  await input(page).setInputFiles(await darkPng(page, "dark.png"));
  await page.locator("#watermark-text").fill("WWWW");
  await page.locator("#watermark-size").fill("15");
  await page.locator("#watermark-opacity").fill("100");
  await page.locator("#watermark-rotation").fill("-30");
  await page.locator("#watermark-position").selectOption("tile");
  await apply(page).click();
  await expect(result(page)).toBeVisible({ timeout: 30_000 });
  const saved = await download(page, "dark-watermarked.png");
  // The plain picture is #202020 (brightness 32); each quarter must have white text in it.
  for (const box of [
    [0, 0, 200, 150],
    [200, 0, 200, 150],
    [0, 150, 200, 150],
    [200, 150, 200, 150],
  ] as const) {
    const corner = await inspect(page, saved, "image/png", [...box]);
    expect(corner.light).toBeGreaterThan(40);
  }
});

test("a JPG stays JPG and a WebP stays WebP", async ({ page, browserName }) => {
  await openTool(page, PATH);
  await input(page).setInputFiles(
    await makeTestJpg(page, "beach.jpg", { width: 320, height: 200 }),
  );
  await apply(page).click();
  const jpg = await download(page, "beach-watermarked.jpg");
  expect([...jpg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

  await input(page).setInputFiles(await darkPng(page, "dark.webp", "image/webp"));
  await apply(page).click();
  if (browserName === "webkit") {
    await expect(page.getByText("This browser cannot write WebP")).toBeVisible({ timeout: 30_000 });
    await download(page, "dark-watermarked.png");
  } else {
    const webp = await download(page, "dark-watermarked.webp");
    expect(webp.subarray(8, 12).toString("latin1")).toBe("WEBP");
  }
});

test("refuses settings over their ranges and text over 100 characters", async ({ page }) => {
  await openTool(page, PATH);
  await input(page).setInputFiles(await darkPng(page, "dark.png"));
  await page.locator("#watermark-size").fill("51");
  await expect(page.locator("#watermark-size-error")).toHaveText("Text size must be from 1 to 50.");
  await expect(apply(page)).toBeDisabled();
  await page.locator("#watermark-size").fill("50");
  await page.locator("#watermark-opacity").fill("4");
  await expect(page.locator("#watermark-opacity-error")).toHaveText(
    "Opacity must be from 5 to 100.",
  );
  await page.locator("#watermark-opacity").fill("5");
  await page.locator("#watermark-rotation").fill("181");
  await expect(page.locator("#watermark-rotation-error")).toHaveText(
    "Rotation must be from -180 to 180.",
  );
  await page.locator("#watermark-rotation").fill("180");
  await page.locator("#watermark-text").fill("a".repeat(101));
  await expect(page.locator("#watermark-text-error")).toHaveText(
    "The watermark text can have at most 100 characters.",
  );
  await page.locator("#watermark-text").fill("a".repeat(100));
  await expect(apply(page)).toBeEnabled();
  await apply(page).click();
  await expect(result(page)).toBeVisible({ timeout: 30_000 });
});

test("takes a picture of exactly 25 MB and refuses one byte more", async ({ page }) => {
  await openTool(page, PATH);
  const small = await makeTestPng(page, "small.png", { width: 200, height: 100 });
  await input(page).setInputFiles(padTo({ ...small, name: "over.png" }, LIMIT + 1));
  await expect(page.getByRole("alert")).toHaveText("over.png: This file is larger than 25 MB.");
  await expect(apply(page)).toBeDisabled();
  await input(page).setInputFiles(padTo({ ...small, name: "at-limit.png" }, LIMIT));
  await apply(page).click();
  await expect(result(page)).toBeVisible({ timeout: 60_000 });
});

test("refuses a file that is not a picture and names a damaged one", async ({ page }) => {
  await openTool(page, PATH);
  await input(page).setInputFiles({
    name: "a.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("GIF89a"),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "a.gif: This file is not a JPG, PNG or WebP image.",
  );
  await input(page).setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a png"),
  });
  await apply(page).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This image could not be read. It may be damaged.",
    { timeout: 30_000 },
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await input(page).setInputFiles(await darkPng(page, "dark.png"));
    await apply(page).click();
    await expect(result(page)).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
