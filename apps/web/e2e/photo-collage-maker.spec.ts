import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/image/photo-collage-maker/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { padTo, type TestImage } from "./support/test-image";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Photo Collage Maker against `wrangler dev` (real CSP and headers). The photos are plain colours
// drawn in the browser under test, so each cell can be told apart. Every collage is downloaded and
// decoded in the page, and the test reads its pixels: background, cells, order and borders.

test.use({ baseURL: edgeURL });
test.setTimeout(120_000);

const PATH = "/photo-collage-maker/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const files = (page: Page) => page.locator("#photo-collage-maker-files");
const rows = (page: Page) =>
  page.getByRole("list", { name: "Photos for the collage" }).locator("li");
const result = (page: Page) => page.getByRole("list", { name: "Your collage" }).locator("li");
const save = (page: Page) => page.getByRole("button", { name: "Save collage" });

/** A plain picture of one colour, as PNG. */
async function photo(page: Page, name: string, color: string, width: number, height: number) {
  const base64 = await page.evaluate(
    async ({ color, width, height }) => {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.fillStyle = color;
      context.fillRect(0, 0, width, height);
      const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    { color, width, height },
  );
  return { name, mimeType: "image/png", buffer: Buffer.from(base64, "base64") } as TestImage;
}

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

/** The size of a picture and the colour at each point, decoded by the browser. */
const pixels = (page: Page, bytes: Buffer, points: Array<[number, number]>) =>
  page.evaluate(
    async ({ base64, points }) => {
      const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([data]));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.drawImage(bitmap, 0, 0);
      return {
        width: bitmap.width,
        height: bitmap.height,
        colors: points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data.slice(0, 3)]),
      };
    },
    { base64: bytes.toString("base64"), points },
  );

const near = (actual: number[] | undefined, expected: number[]) =>
  expect(actual?.every((value, index) => Math.abs(value - (expected[index] ?? 0)) <= 8)).toBe(true);

test("puts two photos side by side on the background, and swaps them", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await files(page).setInputFiles([
    await photo(page, "red.png", "#ff0000", 400, 200),
    await photo(page, "blue.png", "#0000ff", 200, 400),
  ]);
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByRole("img", { name: "Preview of the collage" })).toBeVisible();
  await page.locator("#photo-collage-maker-background").fill("#00ff00");
  await save(page).click();
  await expect(result(page)).toContainText("1080 × 1080 pixels, PNG", { timeout: 30_000 });
  const first = await pixels(page, await download(page, "red-collage.png"), [
    [10, 10],
    [275, 540],
    [805, 540],
    [540, 540],
  ]);
  expect(first).toMatchObject({ width: 1080, height: 1080 });
  near(first.colors[0], [0, 255, 0]);
  near(first.colors[1], [255, 0, 0]);
  near(first.colors[2], [0, 0, 255]);
  near(first.colors[3], [0, 255, 0]);

  await page.getByRole("button", { name: "Swap red.png with the photo after it" }).click();
  await expect(rows(page).first()).toContainText("1. blue.png");
  await page.locator("#photo-collage-maker-border").fill("10");
  await page.locator("#photo-collage-maker-border-color").fill("#000000");
  await save(page).click();
  const swapped = await pixels(page, await download(page, "blue-collage.png"), [
    [275, 540],
    [805, 540],
    [24, 540],
  ]);
  near(swapped.colors[0], [0, 0, 255]);
  near(swapped.colors[1], [255, 0, 0]);
  near(swapped.colors[2], [0, 0, 0]);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("needs every cell filled, takes 6 photos and refuses a 7th, and saves JPG", async ({
  page,
}) => {
  await openTool(page, PATH);
  await files(page).setInputFiles([
    await photo(page, "a.png", "#ff0000", 300, 300),
    await photo(page, "b.png", "#00ff00", 300, 300),
  ]);
  await page.locator("#photo-collage-maker-layout").selectOption("3-left");
  await expect(page.locator("#photo-collage-maker-summary")).toContainText(
    "2 of 3 cells filled. Add 1 more, or choose another layout.",
  );
  await save(page).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This layout holds 3 photos. Add more photos, or choose a layout for fewer.",
  );
  const more = await photo(page, "c.png", "#0000ff", 300, 300);
  await files(page).setInputFiles([1, 2, 3, 4, 5].map((n) => ({ ...more, name: `c${n}.png` })));
  await expect(rows(page)).toHaveCount(6);
  await expect(page.getByText("c5.png: Up to 6 photos can be used.")).toBeVisible();
  await expect(page.locator("#photo-collage-maker-summary")).toContainText(
    "Only the first 3 photos are used.",
  );
  await page.locator("#photo-collage-maker-layout").selectOption("6-grid");
  await page.locator("#photo-collage-maker-size").selectOption("landscape");
  await page.locator("#photo-collage-maker-format").selectOption("jpg");
  await page.locator("#photo-collage-maker-spacing").fill("0");
  await save(page).click();
  const jpg = await download(page, "a-collage.jpg");
  expect([...jpg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  const grid = await pixels(page, jpg, [
    [320, 270],
    [960, 270],
    [1600, 810],
  ]);
  expect(grid).toMatchObject({ width: 1920, height: 1080 });
  near(grid.colors[0], [255, 0, 0]);
  near(grid.colors[1], [0, 255, 0]);
  near(grid.colors[2], [0, 0, 255]);
});

test("spacing goes to 100 and a border to 40, and no further", async ({ page }) => {
  await openTool(page, PATH);
  await files(page).setInputFiles([
    await photo(page, "a.png", "#ff0000", 100, 100),
    await photo(page, "b.png", "#0000ff", 100, 100),
  ]);
  await page.locator("#photo-collage-maker-spacing").fill("101");
  await expect(page.getByText("Spacing must be from 0 to 100 pixels.")).toBeVisible();
  await page.locator("#photo-collage-maker-border").fill("41");
  await expect(page.getByText("Border must be from 0 to 40 pixels.")).toBeVisible();
  await save(page).click();
  await expect(page.getByRole("alert")).toHaveText("Spacing must be from 0 to 100 pixels.");
  await page.locator("#photo-collage-maker-spacing").fill("100");
  await page.locator("#photo-collage-maker-border").fill("40");
  await save(page).click();
  const edge = await pixels(page, await download(page, "a-collage.png"), [
    [50, 540],
    [120, 540],
    [300, 540],
  ]);
  near(edge.colors[0], [255, 255, 255]);
  near(edge.colors[1], [0, 0, 0]);
  near(edge.colors[2], [255, 0, 0]);
});

test("refuses a photo one byte over 25 MB and uses one of exactly 25 MB", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const small = await photo(page, "small.png", "#ff0000", 100, 100);
  const write = (name: string, buffer: Buffer) => {
    const path = testInfo.outputPath(name);
    writeFileSync(path, buffer);
    return path;
  };
  await files(page).setInputFiles([
    write("over.png", padTo(small, LIMIT + 1).buffer),
    write("full.png", padTo(small, LIMIT).buffer),
    write("other.png", small.buffer),
  ]);
  await expect(page.getByText("over.png: This file is larger than 25 MB.")).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  await save(page).click();
  await expect(result(page)).toContainText("full-collage.png", { timeout: 30_000 });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a preview and a result, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await files(page).setInputFiles([
      await photo(page, "a.png", "#ff0000", 100, 100),
      await photo(page, "b.png", "#0000ff", 100, 100),
    ]);
    await save(page).click();
    // Saving encodes a full-size 1080 by 1080 PNG; on a busy CI runner that alone has taken more
    // than the 5-second default, with Save still showing as busy. Wait for the result itself.
    await expect(result(page)).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
