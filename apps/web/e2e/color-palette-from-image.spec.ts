import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/color-design/color-palette-from-image/tool.config";
import { edgeURL } from "./edge";
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

// Color Palette from Image against `wrangler dev` (real CSP and headers): the red and blue example
// of its page, up to eight colours from a photo, the 25 MB limit at and over the edge, wrong and
// damaged files, and axe in both themes.

test.use({ baseURL: edgeURL });
test.setTimeout(120_000);

const PATH = "/color-palette-from-image/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const input = (page: Page) => page.locator("#palette-file");
const swatches = (page: Page) => page.getByRole("list", { name: "Colours" }).locator("li");

/** A PNG 200 by 50: the left three quarters pure red, the rest pure blue. */
async function redAndBlue(page: Page): Promise<TestImage> {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(200, 50);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 150, 50);
    context.fillStyle = "#0000ff";
    context.fillRect(150, 0, 50, 50);
    const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
    return btoa(String.fromCharCode(...bytes));
  });
  return { name: "flag.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

test("gives the red and blue example of its page", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await page.locator("#palette-count").selectOption("2");
  await input(page).setInputFiles(await redAndBlue(page));
  await expect(swatches(page)).toHaveText([/#ff0000\s*75%/, /#0000ff\s*25%/]);
  await page.locator("#palette-count").selectOption("8");
  await expect(swatches(page)).toHaveCount(2);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("finds up to eight colours in a photo", async ({ page }) => {
  await openTool(page, PATH);
  await input(page).setInputFiles(await makeTestPng(page, "photo.png"));
  await expect(swatches(page)).toHaveCount(6);
  await page.locator("#palette-count").selectOption("8");
  await expect(swatches(page)).toHaveCount(8);
  await expect(swatches(page).first()).toHaveText(/#[0-9a-f]{6}/);
});

test("takes a picture of exactly 25 MB and refuses one byte more", async ({ page }) => {
  await openTool(page, PATH);
  const flag = await redAndBlue(page);
  await input(page).setInputFiles(padTo({ ...flag, name: "over.png" }, LIMIT + 1));
  await expect(page.getByRole("alert")).toHaveText("over.png: This file is larger than 25 MB.");
  await input(page).setInputFiles(padTo({ ...flag, name: "at-limit.png" }, LIMIT));
  await expect(swatches(page)).toHaveCount(2, { timeout: 60_000 });
});

test("refuses a file that is not a picture and names a damaged one", async ({ page }) => {
  await openTool(page, PATH);
  await input(page).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("text"),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "notes.txt: This file is not a JPG, PNG or WebP image.",
  );
  await input(page).setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a png"),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "broken.png: This image could not be read. It may be damaged.",
  );
});

test("copies a colour", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium lets a test grant clipboard access");
  await context.grantPermissions(["clipboard-write"]);
  await openTool(page, PATH);
  await input(page).setInputFiles(await redAndBlue(page));
  await page.getByRole("button", { name: "Copy #ff0000" }).click();
  await expect(page.getByText("#ff0000 copied to the clipboard.")).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a palette shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await input(page).setInputFiles(await makeTestPng(page, "photo.png"));
    await expect(swatches(page)).toHaveCount(6);
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
