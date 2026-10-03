import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import manifest from "../../../tools/image/heic-to-jpg/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// HEIC to JPG against `wrangler dev` (real CSP and headers): libheif's WebAssembly, fetched from
// /vendor/libheif/, decodes real HEIC files (e2e/fixtures/README.md) in the tool's worker. The
// pictures are checked pixel by pixel: the quarters keep their colours and a photo stored with a
// rotation box comes out upright. The downloads hold no EXIF, so the GPS position in the fixtures
// is gone. Also: the 50 MB, 20-file and 50-megapixel limits, at and over the edge.

test.use({ baseURL: edgeURL });
test.setTimeout(180_000);

const PATH = "/heic-to-jpg/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const heic = (name: string, buffer = fixture("landscape.heic")) => ({
  name,
  mimeType: "image/heic",
  buffer,
});
const files = (page: Page) => page.locator("#heic-to-jpg-files");
const rows = (page: Page) => page.locator(".ni-fileresult");

/** The colour of the preview at (x, y), as RGB. */
const pixel = (row: Locator, x: number, y: number) =>
  row.locator("img").evaluate(
    async (img: HTMLImageElement, [px, py]) => {
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d");
      context?.drawImage(img, 0, 0);
      return [...(context?.getImageData(px ?? 0, py ?? 0, 1, 1).data ?? [])].slice(0, 3);
    },
    [x, y],
  );

const naturalSize = (row: Locator) =>
  row.locator("img").evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  });

/** Close to a colour, allowing for HEVC and JPG compression. */
function expectColour(actual: number[], expected: [number, number, number]) {
  for (const [index, value] of expected.entries()) {
    expect(Math.abs((actual[index] ?? 0) - value), `${actual} vs ${expected}`).toBeLessThan(40);
  }
}

const RED: [number, number, number] = [220, 30, 30];
const GREEN: [number, number, number] = [30, 160, 40];
const BLUE: [number, number, number] = [30, 60, 220];
const YELLOW: [number, number, number] = [240, 220, 40];

test("converts a HEIC to JPG in the worker, with its colours, and the download has no location", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await files(page).setInputFiles(heic("IMG_0420.HEIC"));

  const row = rows(page).first();
  await expect(row).toHaveAttribute("data-state", "done", { timeout: 60_000 });
  await expect(row).toContainText("320 × 240 pixels");
  expect(await naturalSize(row)).toEqual([320, 240]);
  expectColour(await pixel(row, 40, 40), RED);
  expectColour(await pixel(row, 280, 40), GREEN);
  expectColour(await pixel(row, 40, 200), BLUE);
  expectColour(await pixel(row, 280, 200), YELLOW);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    row.getByRole("button", { name: "Download IMG_0420.jpg" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("IMG_0420.jpg");
  const bytes = readFileSync((await download.path()) ?? "");
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  // The fixture's EXIF holds a GPS position and the make "NetworksInsights test": none of it is
  // in the JPG, which carries no EXIF segment at all.
  expect(fixture("landscape.heic").includes("NetworksInsights test")).toBe(true);
  expect(bytes.includes("Exif")).toBe(false);
  expect(bytes.includes("NetworksInsights test")).toBe(false);

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("a photo stored with a rotation comes out upright", async ({ page }) => {
  await openTool(page, PATH);
  await files(page).setInputFiles(heic("rotated.heic", fixture("rotated.heic")));
  const row = rows(page).first();
  await expect(row).toHaveAttribute("data-state", "done", { timeout: 60_000 });
  // Stored 320 × 240 and turned a quarter turn clockwise: 240 × 320, blue at the top left.
  expect(await naturalSize(row)).toEqual([240, 320]);
  expectColour(await pixel(row, 40, 40), BLUE);
  expectColour(await pixel(row, 200, 40), RED);
  expectColour(await pixel(row, 40, 280), YELLOW);
  expectColour(await pixel(row, 200, 280), GREEN);
});

test("saves PNG, with no EXIF either", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#heic-to-jpg-format").selectOption("png");
  await expect(page.locator("#heic-to-jpg-quality")).toBeDisabled();
  await files(page).setInputFiles(heic("photo.heic"));
  const row = rows(page).first();
  await expect(row).toHaveAttribute("data-state", "done", { timeout: 60_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    row.getByRole("button", { name: "Download photo.png" }).click(),
  ]);
  const bytes = readFileSync((await download.path()) ?? "");
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(bytes.includes("eXIf")).toBe(false);
  expect(bytes.includes("NetworksInsights test")).toBe(false);
});

test("converts 20 photos and refuses the 21st", async ({ page }) => {
  await openTool(page, PATH);
  await files(page).setInputFiles(
    Array.from({ length: 21 }, (_, index) => heic(`photo-${index + 1}.heic`)),
  );
  const alert = page.getByRole("status").filter({ hasText: "One file was not added" });
  await expect(alert).toContainText("photo-21.heic: Only 20 files can be converted at once.");
  await expect(rows(page)).toHaveCount(20);
  await expect(page.locator('.ni-fileresult[data-state="done"]')).toHaveCount(20, {
    timeout: 120_000,
  });
});

test("refuses a file one byte over 50 MB, and converts one of exactly 50 MB", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  // A real HEIC, followed by a `free` box (which readers skip) up to the size wanted.
  const padded = (size: number) => {
    const photo = fixture("landscape.heic");
    const free = Buffer.alloc(size - photo.length);
    free.writeUInt32BE(free.length, 0);
    free.write("free", 4, "latin1");
    return Buffer.concat([photo, free]);
  };
  const over = testInfo.outputPath("over.heic");
  writeFileSync(over, padded(LIMIT + 1));
  await files(page).setInputFiles(over);
  await expect(page.getByRole("status")).toContainText(
    "over.heic: This file is larger than 50 MB.",
  );
  await expect(rows(page)).toHaveCount(0);

  const exact = testInfo.outputPath("exact.heic");
  writeFileSync(exact, padded(LIMIT));
  await files(page).setInputFiles(exact);
  const row = rows(page).first();
  await expect(row).toHaveAttribute("data-state", "done", { timeout: 120_000 });
  await expect(row).toContainText("320 × 240 pixels");
});

test("refuses a photo over 50 megapixels before decoding it, and a file that is not HEIC", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openTool(page, PATH);
  // The fixture with its ispe box saying 10,000 × 5,001: one row over 50 megapixels.
  const huge = Buffer.from(fixture("landscape.heic"));
  const ispe = huge.indexOf("ispe", 0, "latin1");
  huge.writeUInt32BE(10_000, ispe + 8);
  huge.writeUInt32BE(5_001, ispe + 12);
  await files(page).setInputFiles([
    heic("huge.heic", huge),
    { name: "fake.heic", mimeType: "image/heic", buffer: Buffer.from("not a photo at all") },
  ]);
  const [first, second] = [rows(page).nth(0), rows(page).nth(1)];
  await expect(first).toHaveAttribute("data-state", "error", { timeout: 60_000 });
  await expect(first).toContainText(
    "This photo is 10,000 × 5,001 pixels, more than the 50 megapixels this tool can hold in memory.",
  );
  await expect(second).toHaveAttribute("data-state", "error", { timeout: 60_000 });
  await expect(second).toContainText("This file is not a HEIC or HEIF photo.");

  await files(page).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("text"),
  });
  await expect(page.getByRole("status")).toContainText(
    "notes.txt: This file is not a HEIC or HEIF photo.",
  );
  expect(errors).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with results shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await files(page).setInputFiles(heic("photo.heic"));
    await expect(rows(page).first()).toHaveAttribute("data-state", "done", { timeout: 60_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts are the manifest's", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
  await expect(page.getByRole("region", { name: "Quick facts" })).toContainText(
    "Up to 50 MB per input; Up to 20 files at once",
  );
});
