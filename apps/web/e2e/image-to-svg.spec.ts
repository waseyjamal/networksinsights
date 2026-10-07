import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  formatSize,
  isSafeSvg,
  MESSAGES,
  traceSize,
} from "../../../tools/image/image-to-svg/logic";
import manifest from "../../../tools/image/image-to-svg/tool.config";
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

// Image to SVG against `wrangler dev` (real CSP and headers). The fixture, a 200 × 200 white PNG
// with a red square from 50 to 150, is drawn and encoded by the browser under test. The traced SVG
// must be well-formed XML, pass the page's own safety check and a second one here, have a path
// filled close to red, and draw back to the fixture within these limits, written before the first
// run and never raised (ADR 0069):
// - a red fill: some path has red at least 240, green and blue at most 15;
// - mean absolute difference over all pixels and channels at most 4 levels;
// - at least 99% of pixels with every channel within 48 levels (edges may be anti-aliased);
// - the centre (100, 100) within 16 levels of pure red and the corner (5, 5) within 16 of white.
const RED_MIN = 240;
const OTHER_MAX = 15;
const MAX_MEAN = 4;
const CLOSE_LEVELS = 48;
const CLOSE_SHARE = 0.99;
const POINT_LEVELS = 16;

test.use({ baseURL: edgeURL });

const PATH = "/image-to-svg/";
const input = (page: Page) => page.locator("#image-to-svg-file");

async function png(page: Page, width: number, height: number, square: boolean): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ width, height, square }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.fillStyle = "rgb(255, 255, 255)";
      context.fillRect(0, 0, width, height);
      context.fillStyle = "rgb(255, 0, 0)";
      if (square) context.fillRect(50, 50, 100, 100);
      else context.fillRect(width / 4, height / 4, width / 2, height / 2);
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
      const bytes = new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0));
      let text = "";
      for (const byte of bytes) text += String.fromCharCode(byte);
      return btoa(text);
    },
    { width, height, square },
  );
  return Buffer.from(base64, "base64");
}

/** The SVG text drawn by the browser at 200 × 200, compared with the fixture's own pixels. */
function compare(page: Page, svg: string, fixture: Buffer) {
  return page.evaluate(
    async ({ svg, fixture, closeLevels }) => {
      const draw = async (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.src = url;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 200;
        canvas.height = 200;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("no 2d context");
        context.drawImage(img, 0, 0, 200, 200);
        URL.revokeObjectURL(url);
        return context.getImageData(0, 0, 200, 200).data;
      };
      const bytes = Uint8Array.from(atob(fixture), (c) => c.charCodeAt(0));
      const expected = await draw(new Blob([bytes], { type: "image/png" }));
      const actual = await draw(new Blob([svg], { type: "image/svg+xml" }));
      let sum = 0;
      let close = 0;
      for (let i = 0; i < expected.length; i += 4) {
        let worst = 0;
        for (let c = 0; c < 3; c++) {
          const diff = Math.abs((expected[i + c] ?? 0) - (actual[i + c] ?? 0));
          sum += diff;
          worst = Math.max(worst, diff);
        }
        if (worst <= closeLevels) close++;
      }
      const at = (x: number, y: number) => [
        ...actual.slice((y * 200 + x) * 4, (y * 200 + x) * 4 + 3),
      ];
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      return {
        mean: sum / ((expected.length / 4) * 3),
        closeShare: close / (expected.length / 4),
        centre: at(100, 100),
        corner: at(5, 5),
        xmlError: doc.getElementsByTagName("parsererror").length,
        root: doc.documentElement.nodeName,
        elements: [...doc.querySelectorAll("*")].map((node) => node.nodeName),
      };
    },
    { svg, fixture: fixture.toString("base64"), closeLevels: CLOSE_LEVELS },
  );
}

test("traces a red square into a safe SVG that draws back to the picture", async ({
  page,
  browserName,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await page.locator("#image-to-svg-preset").selectOption("2");
  const fixture = await png(page, 200, 200, true);
  await input(page).setInputFiles({ name: "square.png", mimeType: "image/png", buffer: fixture });

  const button = page.getByRole("button", { name: /^Download SVG \(/ });
  await expect(button).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#image-to-svg-scaled")).toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toBe("square.svg");
  const bytes = readFileSync((await download.path()) ?? "");
  // The size shown before the download is the size of the file.
  await expect(button).toHaveText(`Download SVG (${formatSize(bytes.length)})`);
  await expect(page.locator(".ni-fileresult")).toContainText(
    `SVG size ${formatSize(bytes.length)}`,
  );

  const svg = bytes.toString("utf8");
  expect(isSafeSvg(svg)).toBe(true);
  for (const banned of ["<script", "href", "url(", "<style", "<foreignObject", "<!", "<?", " on"]) {
    expect(svg).not.toContain(banned);
  }
  const fills = [...svg.matchAll(/fill="rgb\((\d+),(\d+),(\d+)\)"/g)].map((m) =>
    m.slice(1, 4).map(Number),
  );
  expect(
    fills.some(([r = 0, g = 255, b = 255]) => r >= RED_MIN && g <= OTHER_MAX && b <= OTHER_MAX),
  ).toBe(true);

  const result = await compare(page, svg, fixture);
  console.log(
    `image-to-svg ${browserName}: ${bytes.length} B, mean ${result.mean.toFixed(3)}, within ${CLOSE_LEVELS}: ${(result.closeShare * 100).toFixed(3)}%`,
  );
  expect(result.xmlError).toBe(0);
  expect(result.root).toBe("svg");
  expect(new Set(result.elements)).toEqual(new Set(["svg", "path"]));
  expect(result.mean).toBeLessThanOrEqual(MAX_MEAN);
  expect(result.closeShare).toBeGreaterThanOrEqual(CLOSE_SHARE);
  for (const [index, level] of result.centre.entries()) {
    expect(Math.abs(level - (index === 0 ? 255 : 0))).toBeLessThanOrEqual(POINT_LEVELS);
  }
  for (const level of result.corner) expect(255 - level).toBeLessThanOrEqual(POINT_LEVELS);

  // Another preset traces the same picture again.
  await page.locator("#image-to-svg-preset").selectOption("16");
  await expect(page.getByRole("button", { name: /^Download SVG \(/ })).toBeVisible({
    timeout: 30_000,
  });

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("scales a picture above about 2 megapixels down before tracing, and says so", async ({
  page,
}) => {
  await openTool(page, PATH);
  const big = await png(page, 2000, 1500, false);
  await input(page).setInputFiles({ name: "big.png", mimeType: "image/png", buffer: big });
  const size = traceSize(2000, 1500);
  await expect(page.locator("#image-to-svg-scaled")).toHaveText(
    `The picture is 2000 × 1500 pixels, more than about 2 megapixels, so it was traced at ${size.width} × ${size.height} pixels.`,
    { timeout: 60_000 },
  );
  const button = page.getByRole("button", { name: /^Download SVG \(/ });
  await expect(button).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const svg = readFileSync((await download.path()) ?? "", "utf8");
  expect(svg).toContain(`width="${size.width}" height="${size.height}"`);
  expect(isSafeSvg(svg)).toBe(true);
});

test("refuses a file that is not an image", async ({ page }) => {
  await openTool(page, PATH);
  await input(page).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("text"),
  });
  await expect(page.locator("#image-to-svg-error")).toHaveText(MESSAGES.type);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await input(page).setInputFiles({
      name: "square.png",
      mimeType: "image/png",
      buffer: await png(page, 200, 200, true),
    });
    await expect(page.getByRole("button", { name: /^Download SVG \(/ })).toBeVisible({
      timeout: 30_000,
    });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts are the manifest's", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
