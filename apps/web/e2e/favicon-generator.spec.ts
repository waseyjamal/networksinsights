import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/web-seo/favicon-generator/tool.config";
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

// Favicon Generator against `wrangler dev` (real CSP and headers): a wide picture becomes seven
// files, each downloaded on its own and read back for its size; the .ico header lists 16, 32 and
// 48. Also: the crop note, the 25 MB limit at and over the edge, wrong and damaged files, and axe.

test.use({ baseURL: edgeURL });
test.setTimeout(120_000);

const PATH = "/favicon-generator/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const input = (page: Page) => page.locator("#favicon-file");
const results = (page: Page) => page.getByRole("list", { name: "Your icons" }).locator("li");

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

const pngSize = (bytes: Buffer) => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];

test("a wide picture is cropped to its centre and gives every size the page lists", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await input(page).setInputFiles(
    await makeTestPng(page, "logo.png", { width: 1000, height: 600 }),
  );
  await expect(results(page)).toHaveCount(7, { timeout: 30_000 });
  await expect(page.getByText("logo.png is 1000 by 600 pixels.")).toBeVisible();
  for (const [name, size] of [
    ["favicon-16x16.png", 16],
    ["favicon-32x32.png", 32],
    ["favicon-48x48.png", 48],
    ["apple-touch-icon.png", 180],
    ["icon-192.png", 192],
    ["icon-512.png", 512],
  ] as const) {
    expect(pngSize(await download(page, name))).toEqual([size, size]);
  }
  const ico = await download(page, "favicon.ico");
  expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 3]);
  const sizes = [0, 1, 2].map((i) => ico.readUInt8(6 + i * 16));
  expect(sizes).toEqual([16, 32, 48]);
  for (const i of [0, 1, 2]) {
    const offset = ico.readUInt32LE(6 + i * 16 + 12);
    expect(pngSize(ico.subarray(offset))).toEqual([sizes[i], sizes[i]]);
  }
  await expect(page.locator("#favicon-tags")).toHaveValue(
    /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon.png">/,
  );
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("a square picture gives no crop note", async ({ page }) => {
  await openTool(page, PATH);
  await input(page).setInputFiles(await makeTestPng(page, "square.png", { width: 64, height: 64 }));
  await expect(results(page)).toHaveCount(7, { timeout: 30_000 });
  await expect(page.getByText("The image was not square")).toHaveCount(0);
});

test("takes a picture of exactly 25 MB and refuses one byte more", async ({ page }) => {
  await openTool(page, PATH);
  const small = await makeTestPng(page, "small.png", { width: 64, height: 64 });
  await input(page).setInputFiles(padTo({ ...small, name: "over.png" }, LIMIT + 1));
  await expect(page.getByRole("alert")).toHaveText("over.png: This file is larger than 25 MB.");
  await input(page).setInputFiles(padTo({ ...small, name: "at-limit.png" }, LIMIT));
  await expect(results(page)).toHaveCount(7, { timeout: 60_000 });
});

test("refuses a file that is not a picture and names a damaged one", async ({ page }) => {
  await openTool(page, PATH);
  await input(page).setInputFiles({
    name: "logo.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "logo.svg: This file is not a JPG, PNG or WebP image.",
  );
  await input(page).setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a png"),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "This image could not be read. It may be damaged.",
    { timeout: 30_000 },
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with results shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await input(page).setInputFiles(
      await makeTestPng(page, "logo.png", { width: 300, height: 200 }),
    );
    await expect(results(page)).toHaveCount(7, { timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
