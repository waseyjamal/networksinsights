import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/image/add-text-to-image/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { makeTestJpg, padTo, type TestImage } from "./support/test-image";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Add Text to Image against `wrangler dev` (real CSP and headers). The photos are drawn in the
// browser under test. Every saved picture is downloaded and decoded again, and the test reads its
// pixels: the text must really be drawn where the layer was placed, by typing or by dragging.

test.use({ baseURL: edgeURL });
test.setTimeout(120_000);

const PATH = "/add-text-to-image/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const input = (page: Page) => page.locator("#add-text-to-image-file");
const original = (page: Page) => page.locator("#add-text-to-image-original");
const result = (page: Page) => page.getByRole("list", { name: "Picture with text" }).locator("li");
const save = (page: Page) => page.getByRole("button", { name: "Save picture" });

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

/** Decodes a file in the page: its size and the average brightness of a box of it. */
async function inspect(page: Page, bytes: Buffer, box: [number, number, number, number]) {
  return page.evaluate(
    async ({ base64, box }) => {
      const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([data]));
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
    { base64: bytes.toString("base64"), box },
  );
}

/** A plain dark grey picture, so white text shows clearly where it is drawn. */
async function darkPicture(
  page: Page,
  name: string,
  type = "image/png",
  size = { width: 400, height: 300 },
): Promise<TestImage> {
  const base64 = await page.evaluate(
    async ({ type, size }) => {
      const canvas = new OffscreenCanvas(size.width, size.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.fillStyle = "#202020";
      context.fillRect(0, 0, size.width, size.height);
      const blob = await canvas.convertToBlob({ type, quality: 0.95 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return btoa(binary);
    },
    { type, size },
  );
  return { name, mimeType: type, buffer: Buffer.from(base64, "base64") };
}

async function setLayer(page: Page, fields: Record<string, string>) {
  for (const [id, value] of Object.entries(fields)) {
    await page.locator(`#add-text-to-image-${id}`).fill(value);
  }
}

test("draws the text where it is placed, and moves it by dragging", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await input(page).setInputFiles(await darkPicture(page, "dark.png"));
  await expect(original(page)).toContainText("dark.png: 400 × 300 pixels, PNG");
  await expect(page.getByRole("button", { name: "Text layer 1: Your text" })).toBeVisible();
  await setLayer(page, { text: "WWWW", size: "15", x: "0", y: "0", outline: "0" });
  await save(page).click();
  await expect(result(page)).toContainText("400 × 300 pixels, PNG");
  const first = await download(page, "dark-text.png");
  const topLeft = await inspect(page, first, [0, 0, 200, 80]);
  const bottomRight = await inspect(page, first, [200, 200, 200, 100]);
  expect(topLeft).toMatchObject({ width: 400, height: 300 });
  expect(topLeft.light).toBeGreaterThan(bottomRight.light + 40);

  // Drag the text to the right and down. page.mouse does not scroll, so the text is in view first.
  const item = page.getByRole("button", { name: "Text layer 1: WWWW" });
  await item.evaluate((element) => element.scrollIntoView({ block: "start" }));
  const from = await item.boundingBox();
  const area = await page.locator("#add-text-to-image-canvas").boundingBox();
  if (!from || !area) throw new Error("the text or the photo is not shown");
  await page.mouse.move(from.x + 5, from.y + 5);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * 0.55 + 5, area.y + area.height * 0.4 + 5, {
    steps: 5,
  });
  await page.mouse.up();
  const left = Number(await page.locator("#add-text-to-image-x").inputValue());
  const top = Number(await page.locator("#add-text-to-image-y").inputValue());
  expect(left).toBeGreaterThan(50);
  expect(left).toBeLessThan(60);
  expect(top).toBeGreaterThan(35);
  expect(top).toBeLessThan(45);
  await save(page).click();
  const moved = await download(page, "dark-text.png");
  expect((await inspect(page, moved, [220, 120, 170, 60])).light).toBeGreaterThan(
    (await inspect(page, moved, [0, 0, 150, 80])).light + 40,
  );
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("draws several layers with outline and shadow, up to 10 layers", async ({ page }) => {
  await openTool(page, PATH);
  await input(page).setInputFiles(await darkPicture(page, "dark.png"));
  await setLayer(page, { text: "WW", size: "12", x: "2", y: "2", outline: "0" });
  await page.getByRole("button", { name: "Add text layer" }).click();
  await expect(page.getByRole("button", { name: "Layer 2", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await setLayer(page, { text: "WW", size: "12", x: "70", y: "75", outline: "10" });
  await page.getByLabel("Shadow").check();
  await save(page).click();
  const saved = await download(page, "dark-text.png");
  const corner = (box: [number, number, number, number]) => inspect(page, saved, box);
  const plain = (await corner([150, 120, 100, 60])).light;
  expect((await corner([0, 0, 120, 70])).light).toBeGreaterThan(plain + 40);
  expect((await corner([280, 220, 120, 80])).light).toBeGreaterThan(plain + 30);

  // Layers 3 to 9 are added in one go; the 10th by a real click; the 11th is refused.
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (element) => element.textContent === "Add text layer",
    );
    for (let i = 0; i < 7; i++) button?.click();
  });
  await expect(page.getByRole("button", { name: "Layer 9", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add text layer" }).click();
  await expect(page.getByRole("button", { name: "Layer 10", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add text layer" }).click();
  await expect(page.getByRole("alert")).toHaveText("Up to 10 text layers can be added.");
  await expect(page.getByRole("button", { name: "Layer 11", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Layer 5", exact: true }).click();
  await page.getByRole("button", { name: "Remove this layer" }).click();
  await expect(page.getByRole("button", { name: "Layer 10", exact: true })).toHaveCount(0);
  await save(page).click();
  await expect(result(page)).toBeVisible();
});

test("checks each field, and the text limit of 200 characters", async ({ page }) => {
  await openTool(page, PATH);
  await input(page).setInputFiles(await darkPicture(page, "dark.png"));
  await setLayer(page, { size: "41" });
  await expect(page.getByText("Text size must be from 1 to 40.")).toBeVisible();
  await setLayer(page, { size: "8", text: "x".repeat(201) });
  await expect(page.getByText("A layer can hold at most 200 characters.")).toBeVisible();
  await save(page).click();
  await expect(page.getByRole("alert")).toHaveText("A layer can hold at most 200 characters.");
  await setLayer(page, { text: "x".repeat(200) });
  await save(page).click();
  await expect(result(page)).toBeVisible();
});

test("a JPG stays JPG, and a WebP stays WebP or says it became PNG", async ({ page }) => {
  await openTool(page, PATH);
  await input(page).setInputFiles(await darkPicture(page, "trip.jpg", "image/jpeg"));
  await save(page).click();
  const jpg = await download(page, "trip-text.jpg");
  expect([...jpg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

  await input(page).setInputFiles(await darkPicture(page, "dark.webp", "image/webp"));
  await expect(original(page)).toContainText("dark.webp");
  await save(page).click();
  await expect(result(page)).toBeVisible();
  const writesWebp = await page.evaluate(() =>
    document.createElement("canvas").toDataURL("image/webp").startsWith("data:image/webp"),
  );
  if (writesWebp) {
    const webp = await download(page, "dark-text.webp");
    expect(webp.subarray(8, 12).toString("latin1")).toBe("WEBP");
    await expect(page.locator("#add-text-to-image-webp")).toHaveCount(0);
  } else {
    await expect(page.locator("#add-text-to-image-webp")).toHaveText(
      "Your browser cannot write WebP pictures (Safari cannot), so the picture was saved as PNG instead.",
    );
    const png = await download(page, "dark-text.png");
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
  }
});

test("refuses one byte over 25 MB and one pixel row over 4,096 by 4,096; takes both limits", async ({
  page,
}) => {
  await openTool(page, PATH);
  const small = await darkPicture(page, "small.png");
  await input(page).setInputFiles(padTo({ ...small, name: "over.png" }, LIMIT + 1));
  await expect(page.getByText("over.png: This file is larger than 25 MB.")).toBeVisible();
  await input(page).setInputFiles(padTo({ ...small, name: "full.png" }, LIMIT));
  await expect(original(page)).toHaveText("full.png: 400 × 300 pixels, PNG, 25 MB");

  await input(page).setInputFiles(
    await darkPicture(page, "tall.png", "image/png", { width: 4096, height: 4097 }),
  );
  await expect(page.getByText("tall.png: This image has more than 16.7 megapixels")).toBeVisible();
  await input(page).setInputFiles(
    await makeTestJpg(page, "square.jpg", { width: 4096, height: 4096 }),
  );
  await expect(original(page)).toContainText("square.jpg: 4096 × 4096 pixels, JPG");
  await save(page).click();
  await expect(result(page)).toContainText("4096 × 4096 pixels, JPG", { timeout: 60_000 });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with layers and a result, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await input(page).setInputFiles(await darkPicture(page, "dark.png"));
    await page.getByRole("button", { name: "Add text layer" }).click();
    await save(page).click();
    await expect(result(page)).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
