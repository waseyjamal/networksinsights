import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import exifr from "exifr";
import { formatSize, workSize } from "../../../tools/image/blur-censor-image/logic";
import manifest from "../../../tools/image/blur-censor-image/tool.config";
import { app1Exif, buildTiff } from "../../../tools/image/exif-viewer-remover/logic";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { makeTestJpg, type TestImage, withExifOrientation } from "./support/test-image";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Blur & Censor Image against `wrangler dev` (real CSP and headers). Every picture is drawn here
// by the browser under test; regions are placed by typing their percents, one is drawn with the
// mouse. Each result is downloaded and its pixels decoded in the page and compared with the input.
// The EXIF sample is synthetic (open sea near 0°, 0°, a made-up camera), nothing personal.

test.use({ baseURL: edgeURL });
test.setTimeout(120_000);

// Blur tolerance, fixed before the first run: inside a blurred region the mean of each colour
// channel stays within 4 (of 255) of the input's, and the mean absolute change is at least 10.
const BLUR_MEAN_TOLERANCE = 4;
const BLUR_MIN_CHANGE = 10;

const PATH = "/blur-censor-image/";
const input = (page: Page) => page.locator("#blur-censor-image-file");
const result = (page: Page) => page.getByRole("list", { name: "Censored picture" }).locator("li");
const censor = (page: Page) => page.getByRole("button", { name: "Censor picture" });

interface Decoded {
  width: number;
  height: number;
  data: number[];
}

/** Decodes files in the page, as a viewer shows them (orientation applied). */
function decode(page: Page, files: Buffer[]): Promise<Decoded[]> {
  return page.evaluate(
    async (list) => {
      const out: Array<{ width: number; height: number; data: number[] }> = [];
      for (const base64 of list) {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes]), {
          imageOrientation: "from-image",
        });
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("no 2d context");
        context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        out.push({ width: bitmap.width, height: bitmap.height, data: [...data] });
      }
      return out;
    },
    files.map((file) => file.toString("base64")),
  );
}

const at = (image: Decoded, x: number, y: number) =>
  image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4);

/**
 * A 240 × 160 opaque PNG in which neighbouring pixels differ. "stripes": stripes over a pattern
 * that repeats every few pixels. "ramp": red rises with x and green with y, so blocks a few
 * pixels apart have clearly different averages, with stripes in blue so no block is flat.
 */
async function stripes(
  page: Page,
  name = "stripes.png",
  kind: "stripes" | "ramp" = "stripes",
): Promise<TestImage> {
  const base64 = await page.evaluate(async (kind) => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 160;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    const image = context.createImageData(240, 160);
    for (let y = 0; y < 160; y++) {
      for (let x = 0; x < 240; x++) {
        const i = (y * 240 + x) * 4;
        if (kind === "ramp") {
          image.data[i] = x;
          image.data[i + 1] = Math.floor(y * 1.5);
          image.data[i + 2] = x % 4 < 2 ? 200 : 40;
        } else {
          image.data[i] = (x * 37 + y * 11) % 256;
          image.data[i + 1] = x % 4 < 2 ? 220 : 30;
          image.data[i + 2] = (y * 9) % 256;
        }
        image.data[i + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
    const bytes = new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0));
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
  }, kind);
  return { name, mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

interface Mismatch {
  x: number;
  y: number;
  expected: number[];
  actual: number[];
}

/** Every pixel that is not what `expected` says, as plain data: one assertion checks them all. */
function mismatches(image: Decoded, expected: (x: number, y: number) => number[]): Mismatch[] {
  const out: Mismatch[] = [];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const want = expected(x, y);
      const i = (y * image.width + x) * 4;
      if (want.some((value, c) => image.data[i + c] !== value)) {
        out.push({ x, y, expected: want, actual: image.data.slice(i, i + 4) });
      }
    }
  }
  return out;
}

/** The type of every chunk of a PNG, in order, read from the chunk lengths to the end. */
function pngChunks(png: Buffer): Array<{ type: string; data: Buffer }> {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: Array<{ type: string; data: Buffer }> = [];
  let at = 8;
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at);
    chunks.push({
      type: png.subarray(at + 4, at + 8).toString("latin1"),
      data: png.subarray(at + 8, at + 8 + length),
    });
    at += 12 + length;
  }
  expect(at).toBe(png.length);
  return chunks;
}

/**
 * Firefox's PNG encoder writes a private deBG chunk: 16 upper-case hex digits that change with the
 * pixels. It was shown to be independent of the input's metadata (the outputs of a plain input and
 * of the same pixels with EXIF and GPS were byte-identical), so it is allowed in exactly that form.
 */
const isFirefoxDebg = (chunk: { type: string; data: Buffer }) =>
  chunk.type === "deBG" &&
  chunk.data.length === 16 &&
  /^[0-9A-F]{16}$/.test(chunk.data.toString("latin1"));

/** Chunks of pixels and of display settings: none of them holds EXIF, GPS or text. */
const IMAGE_CHUNKS = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "pHYs",
  "sRGB",
  "gAMA",
  "cHRM",
  "iCCP",
  "sBIT",
  "bKGD",
]);

/** No metadata chunk, and none of the synthetic EXIF values anywhere in the bytes. */
function expectNoMetadataInPng(png: Buffer) {
  const chunks = pngChunks(png);
  const types = chunks.map((chunk) => chunk.type);
  expect(types[0]).toBe("IHDR");
  expect(types.at(-1)).toBe("IEND");
  expect(
    chunks
      .filter((chunk) => !IMAGE_CHUNKS.has(chunk.type) && !isFirefoxDebg(chunk))
      .map((chunk) => `${chunk.type}: ${chunk.data.toString("hex")}`),
  ).toEqual([]);
  for (const type of ["eXIf", "iTXt", "tEXt", "zTXt"]) expect(types).not.toContain(type);
  expectNoSyntheticValues(png);
}

/** The fixture's GPS latitude (0° 15′) and longitude (0° 30′) as TIFF rationals, both byte orders. */
function gpsBytes(): Buffer[] {
  const out: Buffer[] = [];
  for (const minutes of [15, 30]) {
    for (const big of [true, false]) {
      const buffer = Buffer.alloc(24);
      [0, 1, minutes, 1, 0, 1].forEach((value, k) => {
        if (big) buffer.writeUInt32BE(value, k * 4);
        else buffer.writeUInt32LE(value, k * 4);
      });
      out.push(buffer);
    }
  }
  return out;
}

function expectNoSyntheticValues(file: Buffer) {
  for (const text of ["Exif", "TestCam", "Model X1", "2024:05:06"]) {
    expect(file.includes(Buffer.from(text, "latin1")), text).toBe(false);
  }
  for (const bytes of gpsBytes()) expect(file.includes(bytes), "GPS rational").toBe(false);
}

interface RegionSpec {
  mode: "fill" | "pixelate" | "blur";
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  block?: number;
  radius?: number;
}

/** Adds a region with the button and types its place and setting, as a keyboard user would. */
async function addRegion(page: Page, region: RegionSpec) {
  await page.getByRole("button", { name: "Add a region" }).click();
  await page.locator("#blur-censor-image-x").fill(String(region.x));
  await page.locator("#blur-censor-image-y").fill(String(region.y));
  await page.locator("#blur-censor-image-width").fill(String(region.width));
  await page.locator("#blur-censor-image-height").fill(String(region.height));
  await page.locator("#blur-censor-image-mode").selectOption(region.mode);
  if (region.color) await page.locator("#blur-censor-image-color").fill(region.color);
  if (region.block) await page.locator("#blur-censor-image-block").fill(String(region.block));
  if (region.radius) await page.locator("#blur-censor-image-radius").fill(String(region.radius));
}

/** Censors, checks the size shown before download is the file's size, and downloads it. */
async function run(page: Page, name: string): Promise<Buffer> {
  await censor(page).click();
  await expect(result(page)).toBeVisible({ timeout: 60_000 });
  const shown = (await result(page).textContent()) ?? "";
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  const bytes = readFileSync((await saved.path()) ?? "");
  expect(shown).toContain(formatSize(bytes.length));
  return bytes;
}

function inside(x: number, y: number, box: [number, number, number, number]) {
  return x >= box[0] && x < box[0] + box[2] && y >= box[1] && y < box[1] + box[3];
}

test("a solid fill is exactly the colour, and every pixel outside is unchanged", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  const picture = await stripes(page);
  await input(page).setInputFiles(picture);
  await addRegion(page, { mode: "fill", x: 25, y: 25, width: 50, height: 50, color: "#12a4f0" });
  const saved = await run(page, "stripes-censored.png");
  expect([...saved.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  const [before, after] = await decode(page, [picture.buffer, saved]);
  if (!before || !after) throw new Error("not decoded");
  expect(after).toMatchObject({ width: 240, height: 160 });
  const box: [number, number, number, number] = [60, 40, 120, 80];
  let filled = 0;
  // All 38,400 pixels are checked, in plain code, then one assertion shows the first 5 misses.
  const wrong = mismatches(after, (x, y) => {
    if (!inside(x, y, box)) return at(before, x, y);
    filled++;
    return [0x12, 0xa4, 0xf0, 255];
  });
  expect(wrong.length, JSON.stringify(wrong.slice(0, 5))).toBe(0);
  expect(filled).toBe(120 * 80);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("pixelate gives uniform blocks of the chosen size, and the outside is unchanged", async ({
  page,
}) => {
  await openTool(page, PATH);
  const picture = await stripes(page, "ramp.png", "ramp");
  await input(page).setInputFiles(picture);
  // 10% and 50% of 240 × 160: x 24 to 143, y 16 to 95, six by four blocks of 20 pixels.
  await addRegion(page, { mode: "pixelate", x: 10, y: 10, width: 50, height: 50, block: 20 });
  const saved = await run(page, "ramp-censored.png");
  const [before, after] = await decode(page, [picture.buffer, saved]);
  if (!before || !after) throw new Error("not decoded");
  const box: [number, number, number, number] = [24, 16, 120, 80];
  // The fixture can fail this test: in the input, the first two blocks of the top row have red
  // averages 20 apart, and the first block is not one colour.
  const averageRed = (x0: number, y0: number) => {
    let sum = 0;
    for (let y = y0; y < y0 + 20; y++)
      for (let x = x0; x < x0 + 20; x++) sum += at(before, x, y)[0] ?? 0;
    return sum / 400;
  };
  expect(Math.abs(averageRed(44, 16) - averageRed(24, 16))).toBeGreaterThanOrEqual(15);
  expect(at(before, 24, 16)).not.toEqual(at(before, 25, 16));
  const colours = new Set<string>();
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < 240; x++) {
      if (inside(x, y, box)) {
        const corner = at(
          after,
          24 + Math.floor((x - 24) / 20) * 20,
          16 + Math.floor((y - 16) / 20) * 20,
        );
        expect(at(after, x, y)).toEqual(corner);
        colours.add(corner.join());
      } else {
        expect(at(after, x, y)).toEqual(at(before, x, y));
      }
    }
  }
  // The 24 blocks are not all one colour: each is the average of its own pixels.
  expect(colours.size).toBeGreaterThan(1);
  // Neighbouring blocks differ, so the block edges really are every 20 pixels.
  expect(at(after, 43, 16)).not.toEqual(at(after, 44, 16));
});

test("blur changes the region but keeps its mean colour close", async ({ page }) => {
  await openTool(page, PATH);
  const picture = await stripes(page);
  await input(page).setInputFiles(picture);
  await addRegion(page, { mode: "blur", x: 25, y: 25, width: 50, height: 50, radius: 6 });
  const saved = await run(page, "stripes-censored.png");
  const [before, after] = await decode(page, [picture.buffer, saved]);
  if (!before || !after) throw new Error("not decoded");
  const box: [number, number, number, number] = [60, 40, 120, 80];
  const sumBefore = [0, 0, 0];
  const sumAfter = [0, 0, 0];
  let change = 0;
  let count = 0;
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < 240; x++) {
      const a = at(before, x, y);
      const b = at(after, x, y);
      if (!inside(x, y, box)) {
        expect(b).toEqual(a);
        continue;
      }
      count++;
      for (let c = 0; c < 3; c++) {
        sumBefore[c] = (sumBefore[c] ?? 0) + (a[c] ?? 0);
        sumAfter[c] = (sumAfter[c] ?? 0) + (b[c] ?? 0);
        change += Math.abs((b[c] ?? 0) - (a[c] ?? 0));
      }
    }
  }
  for (let c = 0; c < 3; c++) {
    const drift = Math.abs((sumAfter[c] ?? 0) - (sumBefore[c] ?? 0)) / count;
    expect(drift).toBeLessThanOrEqual(BLUR_MEAN_TOLERANCE);
  }
  expect(change / (count * 3)).toBeGreaterThanOrEqual(BLUR_MIN_CHANGE);
});

test("overlapping regions: the later one is on top, and a region reaches the edge", async ({
  page,
}) => {
  await openTool(page, PATH);
  const picture = await stripes(page);
  await input(page).setInputFiles(picture);
  await addRegion(page, { mode: "fill", x: 0, y: 0, width: 60, height: 60, color: "#ff0000" });
  await addRegion(page, { mode: "fill", x: 40, y: 40, width: 60, height: 60, color: "#0000ff" });
  await expect(page.locator("#blur-censor-image-summary")).toContainText("2 regions");
  const saved = await run(page, "stripes-censored.png");
  const [before, after] = await decode(page, [picture.buffer, saved]);
  if (!before || !after) throw new Error("not decoded");
  const red: [number, number, number, number] = [0, 0, 144, 96];
  const blue: [number, number, number, number] = [96, 64, 144, 96];
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < 240; x++) {
      if (inside(x, y, blue)) expect(at(after, x, y)).toEqual([0, 0, 255, 255]);
      else if (inside(x, y, red)) expect(at(after, x, y)).toEqual([255, 0, 0, 255]);
      else expect(at(after, x, y)).toEqual(at(before, x, y));
    }
  }
  // The corners of the picture are covered: the regions touch its edges.
  expect(at(after, 0, 0)).toEqual([255, 0, 0, 255]);
  expect(at(after, 239, 159)).toEqual([0, 0, 255, 255]);
});

test("a region drawn with the mouse is hidden", async ({ page }) => {
  await openTool(page, PATH);
  await input(page).setInputFiles(await stripes(page));
  const canvas = page.locator("#blur-censor-image-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#blur-censor-image-summary")).toContainText("1 region");
  const saved = await run(page, "stripes-censored.png");
  const [after] = await decode(page, [saved]);
  if (!after) throw new Error("not decoded");
  // The default is a black fill; the middle of the drag is black.
  expect(at(after, 72, 48)).toEqual([0, 0, 0, 255]);
});

const SYNTHETIC_EXIF = () =>
  Buffer.from(
    app1Exif(
      buildTiff(
        [
          { tag: 0x010f, type: "ascii", value: "TestCam" },
          { tag: 0x0110, type: "ascii", value: "Model X1" },
        ],
        {
          exif: [{ tag: 0x9003, type: "ascii", value: "2024:05:06 07:08:09" }],
          gps: [
            { tag: 0x0001, type: "ascii", value: "N" },
            { tag: 0x0002, type: "rational", value: [0, 1, 15, 1, 0, 1] },
            { tag: 0x0003, type: "ascii", value: "W" },
            { tag: 0x0004, type: "rational", value: [0, 1, 30, 1, 0, 1] },
          ],
        },
      ),
    ),
  );

for (const [format, name] of [
  ["image/png", "camera-censored.png"],
  ["image/jpeg", "camera-censored.jpg"],
] as const) {
  test(`EXIF and GPS of the input are not in the ${format} output`, async ({ page }) => {
    await openTool(page, PATH);
    const plain = await makeTestJpg(page, "camera.jpg", { width: 200, height: 120 });
    const photo = Buffer.concat([
      plain.buffer.subarray(0, 2),
      SYNTHETIC_EXIF(),
      plain.buffer.subarray(2),
    ]);
    // The sample is what the test says it is.
    expect((await exifr.gps(photo))?.latitude).toBeCloseTo(0.25, 6);
    expect((await exifr.parse(photo))?.Make).toBe("TestCam");
    await input(page).setInputFiles({ ...plain, buffer: photo });
    await addRegion(page, { mode: "fill", x: 0, y: 0, width: 10, height: 10, color: "#000000" });
    await page.locator("#blur-censor-image-format").selectOption(format);
    const saved = await run(page, name);
    if (format === "image/png") {
      // exifr reads a PNG's IHDR fields too, so the PNG is checked chunk by chunk instead.
      expectNoMetadataInPng(saved);
      // The same pixels without EXIF or GPS give a byte-identical file.
      await input(page).setInputFiles(plain);
      await addRegion(page, { mode: "fill", x: 0, y: 0, width: 10, height: 10, color: "#000000" });
      const fromPlain = await run(page, name);
      expect(saved.equals(fromPlain), `${saved.length} vs ${fromPlain.length} bytes`).toBe(true);
    } else {
      expect(await exifr.parse(saved, { gps: true, xmp: true, iptc: true })).toBeUndefined();
      expect(await exifr.gps(saved)).toBeUndefined();
      expectNoSyntheticValues(saved);
    }
  });
}

test("a JPG stored sideways with EXIF orientation 6 comes out the right way up", async ({
  page,
}) => {
  await openTool(page, PATH);
  // Stored 200 × 100: left half red, right half blue. Orientation 6 shows it turned 90° clockwise,
  // 100 × 200 with red at the top.
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 100;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 100, 100);
    context.fillStyle = "#0000ff";
    context.fillRect(100, 0, 100, 100);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.95));
    const bytes = new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0));
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
  });
  const rotated = withExifOrientation(
    { name: "sideways.jpg", mimeType: "image/jpeg", buffer: Buffer.from(base64, "base64") },
    6,
  );
  await input(page).setInputFiles(rotated);
  await expect(page.locator("#blur-censor-image-original")).toContainText("100 × 200 pixels");
  // A small green fill at the bottom right, to see where the region lands.
  await addRegion(page, { mode: "fill", x: 80, y: 90, width: 20, height: 10, color: "#00ff00" });
  const saved = await run(page, "sideways-censored.png");
  // The output carries no orientation tag, so every viewer shows the pixels as they are stored.
  expectNoMetadataInPng(saved);
  const [after] = await decode(page, [saved]);
  if (!after) throw new Error("not decoded");
  expect(after).toMatchObject({ width: 100, height: 200 });
  const top = at(after, 50, 40);
  const bottom = at(after, 40, 160);
  expect(top[0]).toBeGreaterThan(200);
  expect(top[2]).toBeLessThan(60);
  expect(bottom[2]).toBeGreaterThan(200);
  expect(bottom[0]).toBeLessThan(60);
  expect(at(after, 95, 195)).toEqual([0, 255, 0, 255]);
});

test("a picture over 16 megapixels is scaled down, and the page says so", async ({ page }) => {
  await openTool(page, PATH);
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 5000;
    canvas.height = 4000;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.fillStyle = "#336699";
    context.fillRect(0, 0, 5000, 4000);
    context.fillStyle = "#ffcc00";
    context.fillRect(0, 0, 2500, 2000);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
    const bytes = new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0));
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(text);
  });
  const expected = workSize(5000, 4000);
  expect(expected.width * expected.height).toBeLessThanOrEqual(16_000_000);
  await input(page).setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
  await expect(page.locator(".ni-alert", { hasText: "Scaled down" })).toContainText(
    `This picture is 5,000 × 4,000 pixels, over 16 megapixels, so it was scaled down to 4,472 × 3,577 pixels.`,
    { timeout: 30_000 },
  );
  expect(expected).toEqual({ width: 4472, height: 3577 });
  await addRegion(page, { mode: "fill", x: 0, y: 0, width: 10, height: 10, color: "#000000" });
  const saved = await run(page, "large-censored.png");
  await expect(result(page)).toContainText("4,472 × 3,577 pixels");
  const size = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes]));
    return { width: bitmap.width, height: bitmap.height };
  }, saved.toString("base64"));
  expect(size).toEqual(expected);
});

test("refuses a file that is not a picture, a damaged one, and censoring with no region", async ({
  page,
}) => {
  await openTool(page, PATH);
  await input(page).setInputFiles({
    name: "a.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("GIF89a"),
  });
  await expect(page.locator(".ni-alert")).toContainText(
    "a.gif: This file is not a JPG, PNG or WebP image.",
  );
  await input(page).setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a png"),
  });
  await expect(page.locator(".ni-alert")).toContainText(
    "broken.png: This image could not be read. It may be damaged.",
  );
  await input(page).setInputFiles(await stripes(page));
  await censor(page).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Draw at least one region over what you want to hide.",
  );
  await addRegion(page, { mode: "pixelate", x: 0, y: 0, width: 50, height: 50, block: 1 });
  await expect(page.locator("#blur-censor-image-block-error")).toHaveText(
    "Block size must be a whole number from 2 to 200.",
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a region and a result shown, ${theme} theme`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await input(page).setInputFiles(await stripes(page));
    await addRegion(page, { mode: "blur", x: 10, y: 10, width: 30, height: 30, radius: 4 });
    await censor(page).click();
    await expect(result(page)).toBeVisible({ timeout: 60_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
