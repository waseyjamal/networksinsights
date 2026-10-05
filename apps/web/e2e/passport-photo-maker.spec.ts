import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/image/passport-photo-maker/tool.config";
import { collectErrors } from "./helpers";
import { makeTestPng, padTo, type TestImage } from "./support/test-image";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Passport Photo Maker: a canvas on the page crops and resizes a picture drawn in the browser
// under test. Each JPG is read back: its pixel size and DPI from its own bytes, and its colours by
// decoding it in the page. Also: dragging and the keyboard move the frame, the print sheet layout,
// custom sizes, every number limit, the 50-megapixel rule and 25 MB at and over the edge.

test.setTimeout(120_000);

const PATH = "/passport-photo-maker/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const file = (page: Page) => page.locator("#passport-photo-maker-file");
const field = (page: Page, key: string) => page.locator(`#passport-photo-maker-${key}`);
const results = (page: Page) =>
  page.getByRole("list", { name: "Passport photo files" }).locator("li");

/** Width, height and DPI read from a JPG's own bytes (its SOF and JFIF segments). */
function jpegFacts(bytes: Buffer) {
  let dpi: number | undefined;
  if (bytes[3] === 0xe0 && bytes[13] === 1) dpi = bytes.readUInt16BE(14);
  let at = 2;
  while (at < bytes.length) {
    const marker = bytes[at + 1] ?? 0;
    const length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xc2) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7), dpi };
    }
    at += 2 + length;
  }
  throw new Error("no SOF segment");
}

/** A picture whose left half is red and right half blue. */
async function twoColours(page: Page): Promise<TestImage> {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(1200, 800);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no context");
    context.fillStyle = "rgb(220, 0, 0)";
    context.fillRect(0, 0, 600, 800);
    context.fillStyle = "rgb(0, 0, 220)";
    context.fillRect(600, 0, 600, 800);
    const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
  });
  return { name: "halves.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

/** A plain PNG of any size, one colour, so even 50 megapixels stay a small file. */
async function plainPng(page: Page, name: string, width: number, height: number) {
  const base64 = await page.evaluate(
    async ({ width, height }) => {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no context");
      context.fillStyle = "rgb(200, 200, 200)";
      context.fillRect(0, 0, width, height);
      const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
      let text = "";
      for (const byte of bytes) text += String.fromCharCode(byte);
      return btoa(text);
    },
    { width, height },
  );
  return { name, mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

/** The average colour of a JPG, decoded by the browser. */
async function averageColour(page: Page, bytes: Buffer) {
  return page.evaluate(async (base64) => {
    const binary = atob(base64);
    const data = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([data], { type: "image/jpeg" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no context");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let r = 0;
    let b = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      r += pixels[i] ?? 0;
      b += pixels[i + 2] ?? 0;
    }
    const count = pixels.length / 4;
    return { r: r / count, b: b / count };
  }, bytes.toString("base64"));
}

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

async function opened(page: Page, image: TestImage) {
  await file(page).setInputFiles(image);
  await expect(field(page, "original")).toContainText(image.name);
}

test("makes a 35 × 45 mm photo of 413 × 531 pixels at 300 DPI, as the page example says", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await opened(page, await makeTestPng(page));
  await expect(field(page, "size")).toHaveValue("uk");
  await expect(field(page, "pixels")).toHaveText("The photo will be 413 × 531 pixels.");
  await expect(field(page, "source")).toContainText("Size checked on 5 October 2026 at");
  await expect(
    page.getByRole("link", { name: "GOV.UK, Photos for passports: photo requirements" }),
  ).toHaveAttribute("href", "https://www.gov.uk/photos-for-passports/photo-requirements");
  await page.getByRole("button", { name: "Make photo" }).click();
  await expect(results(page)).toContainText("413 × 531 pixels, 35 mm × 45 mm at 300 DPI");
  const facts = jpegFacts(await download(page, "test-photo-passport-413x531.jpg"));
  expect(facts).toEqual({ width: 413, height: 531, dpi: 300 });
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("lays out 8 copies on 4 × 6 inch paper, and 2 of the US size", async ({ page }) => {
  await openTool(page, PATH);
  await opened(page, await makeTestPng(page));
  await page.getByRole("button", { name: "Make print sheet" }).click();
  await expect(results(page)).toContainText(
    "8 copies (4 × 2), landscape, 1800 × 1200 pixels at 300 DPI",
  );
  const sheet = jpegFacts(await download(page, "test-photo-sheet-4x6.jpg"));
  expect(sheet).toEqual({ width: 1800, height: 1200, dpi: 300 });

  await field(page, "size").selectOption("us");
  await expect(
    page.getByRole("link", { name: "travel.state.gov, U.S. Passport Photos" }),
  ).toBeVisible();
  await expect(field(page, "pixels")).toHaveText("The photo will be 600 × 600 pixels.");
  await page.getByRole("button", { name: "Make print sheet" }).click();
  await expect(results(page)).toContainText("2 copies (1 × 2), portrait, 1200 × 1800 pixels");
  await page.getByRole("button", { name: "Make photo" }).click();
  const photo = jpegFacts(await download(page, "test-photo-passport-600x600.jpg"));
  expect(photo).toEqual({ width: 600, height: 600, dpi: 300 });
});

test("dragging the frame and the arrow keys choose the part of the photo", async ({ page }) => {
  await openTool(page, PATH);
  await opened(page, await twoColours(page));
  const frame = field(page, "frame");
  await page.getByRole("button", { name: "Smaller frame" }).click();
  await page.getByRole("button", { name: "Smaller frame" }).click();
  // Drag far to the right: the frame stops at the edge, over the blue half.
  const box = await frame.boundingBox();
  if (!box) throw new Error("no frame");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 600, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Make photo" }).click();
  let colour = await averageColour(page, await download(page, "halves-passport-413x531.jpg"));
  expect(colour.b).toBeGreaterThan(200);
  expect(colour.r).toBeLessThan(20);

  // From the keyboard: Shift and the left arrow, many times, to the red half.
  await frame.focus();
  for (let step = 0; step < 25; step++) await page.keyboard.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "Make photo" }).click();
  colour = await averageColour(page, await download(page, "halves-passport-413x531.jpg"));
  expect(colour.r).toBeGreaterThan(200);
  expect(colour.b).toBeLessThan(20);
});

test("takes a custom size in inches, and refuses sizes and DPI outside the limits", async ({
  page,
}) => {
  await openTool(page, PATH);
  await field(page, "size").selectOption("custom");
  await field(page, "unit").selectOption("in");
  await field(page, "width").fill("2");
  await field(page, "height").fill("2.5");
  await expect(field(page, "pixels")).toHaveText("The photo will be 600 × 750 pixels.");
  await field(page, "width").fill("0.39");
  await expect(field(page, "pixels")).toHaveText(
    "The width must be a number from 0.4 to 3.9 inches.",
  );
  await field(page, "unit").selectOption("mm");
  await field(page, "width").fill("100");
  await field(page, "height").fill("100.1");
  await expect(field(page, "pixels")).toHaveText("The height must be a number from 10 to 100 mm.");
  await field(page, "height").fill("10");
  await expect(field(page, "pixels")).toHaveText("The photo will be 1181 × 118 pixels.");
  await field(page, "dpi").fill("601");
  await expect(field(page, "pixels")).toHaveText("The DPI must be a whole number from 150 to 600.");
  await field(page, "dpi").fill("150");
  await expect(field(page, "pixels")).toHaveText("The photo will be 591 × 59 pixels.");
});

test("refuses a print sheet over 16.7 megapixels", async ({ page }) => {
  await openTool(page, PATH);
  await opened(page, await makeTestPng(page));
  await field(page, "dpi").fill("600");
  await field(page, "paper").selectOption("a4");
  await page.getByRole("button", { name: "Make print sheet" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This sheet would be larger than 16.7 megapixels, more than some phones can draw. Choose a smaller paper or a lower DPI.",
  );
  await field(page, "paper").selectOption("5x7");
  await page.getByRole("button", { name: "Make print sheet" }).click();
  await expect(results(page)).toContainText("3000 × 4200 pixels at 600 DPI");
});

test("takes 50 megapixels and refuses one row more", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(await plainPng(page, "over.png", 10_000, 5_001));
  await expect(page.getByText("over.png: This picture has more than 50 megapixels.")).toBeVisible({
    timeout: 60_000,
  });
  await opened(page, await plainPng(page, "max.png", 10_000, 5_000));
  await expect(field(page, "original")).toContainText("max.png: 10000 × 5000 pixels");
});

test("refuses one byte over 25 MB, and works with a picture of exactly 25 MB", async ({ page }) => {
  await openTool(page, PATH);
  const image = await makeTestPng(page);
  await file(page).setInputFiles(padTo({ ...image, name: "over.png" }, LIMIT + 1));
  await expect(page.getByText("over.png: This file is larger than 25 MB.")).toBeVisible();
  await opened(page, padTo({ ...image, name: "at-limit.png" }, LIMIT));
  await page.getByRole("button", { name: "Make photo" }).click();
  await expect(results(page)).toContainText("413 × 531 pixels");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with both files shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await opened(page, await makeTestPng(page));
    await page.getByRole("button", { name: "Make photo" }).click();
    await page.getByRole("button", { name: "Make print sheet" }).click();
    await expect(results(page)).toHaveCount(2);
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
