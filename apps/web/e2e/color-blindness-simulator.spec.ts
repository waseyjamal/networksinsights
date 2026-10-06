import { writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { simulate } from "../../../tools/color-design/color-blindness-simulator/logic";
import manifest from "../../../tools/color-design/color-blindness-simulator/tool.config";
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

// Color Blindness Simulator against `wrangler dev` (real CSP and headers). A picture of pure red is
// drawn in the browser; each view's canvas is read back and must hold exactly the colour the
// published matrices give (logic.ts), and the original must be unchanged.

test.use({ baseURL: edgeURL });
test.setTimeout(120_000);

const PATH = "/color-blindness-simulator/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const file = (page: Page) => page.locator("#color-blindness-simulator-file");

async function picture(page: Page, name: string, color: string, size = 200): Promise<TestImage> {
  const base64 = await page.evaluate(
    async ({ color, size }) => {
      const canvas = new OffscreenCanvas(size, size);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.fillStyle = color;
      context.fillRect(0, 0, size, size);
      const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    { color, size },
  );
  return { name, mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

const centre = (page: Page, view: string) =>
  page.locator(`#color-blindness-simulator-${view}`).evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    return [...(context?.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data ?? [])].slice(
      0,
      3,
    );
  });

test("shows the original and four views with the published colours", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(page.getByText("An approximation, not a medical test")).toBeVisible();
  await file(page).setInputFiles(await picture(page, "red.png", "#ff0000"));
  await expect(page.locator("#color-blindness-simulator-summary")).toContainText(
    "red.png: 200 × 200 pixels",
  );
  await expect(page.getByText("Source: Machado, Oliveira and Fernandes (2009)")).toBeVisible();
  for (const caption of [
    "Original",
    "Protanopia (no red cones)",
    "Achromatopsia (no colour vision)",
  ])
    await expect(page.getByText(caption, { exact: true })).toBeVisible();
  await expect.poll(() => centre(page, "original")).toEqual([255, 0, 0]);
  for (const vision of ["protanopia", "deuteranopia", "tritanopia", "achromatopsia"] as const) {
    const seen = await centre(page, vision);
    const expected = simulate(vision, [255, 0, 0]);
    seen.forEach((value, index) => {
      expect(Math.abs(value - (expected[index] ?? 0))).toBeLessThanOrEqual(1);
    });
  }
  const grey = await centre(page, "achromatopsia");
  expect(grey[0]).toBe(grey[1]);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("draws a large picture at most 1000 pixels a side", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(await picture(page, "big.png", "#00ff00", 2400));
  await expect(page.locator("#color-blindness-simulator-tritanopia")).toHaveAttribute(
    "width",
    "1000",
  );
});

test("refuses one byte over 25 MB and opens a picture of exactly 25 MB", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const small = await picture(page, "small.png", "#0000ff");
  const write = (name: string, bytes: number) => {
    const path = testInfo.outputPath(name);
    writeFileSync(path, padTo(small, bytes).buffer);
    return path;
  };
  await file(page).setInputFiles(write("over.png", LIMIT + 1));
  await expect(page.getByRole("alert")).toHaveText("over.png: This file is larger than 25 MB.");
  await file(page).setInputFiles(write("full.png", LIMIT));
  await expect(page.locator("#color-blindness-simulator-summary")).toContainText(
    "full.png: 200 × 200 pixels, 25 MB",
  );
  await file(page).setInputFiles({
    name: "a.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("GIF89a"),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "a.gif: This file is not a JPG, PNG or WebP image.",
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with the views shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(await picture(page, "red.png", "#ff0000"));
    await expect(page.locator("#color-blindness-simulator-achromatopsia")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
