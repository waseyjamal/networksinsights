import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/image/images-to-gif/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { readMedia } from "./media";
import { padTo, type TestImage } from "./support/test-image";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Images to GIF against `wrangler dev` (real CSP and headers). The pictures are plain colours drawn
// in the browser under test, so each frame can be told apart. Every GIF is downloaded and read in
// Node (size, frames, delays, loop), and its first frame is decoded in the page to check the order.

test.use({ baseURL: edgeURL });
test.setTimeout(180_000);

const PATH = "/images-to-gif/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const files = (page: Page) => page.locator("#images-to-gif-files");
const rows = (page: Page) => page.getByRole("list", { name: "Pictures for the GIF" }).locator("li");
const result = (page: Page) => page.getByRole("list", { name: "Your GIF" }).locator("li");
const make = (page: Page) => page.getByRole("button", { name: "Make GIF" });

/** Plain pictures of the given colours, `width` by `height`, as PNG. */
async function pictures(
  page: Page,
  colors: string[],
  size = { width: 400, height: 300 },
): Promise<TestImage[]> {
  const encoded = await page.evaluate(
    async ({ colors, size }) => {
      const out: string[] = [];
      for (const color of colors) {
        const canvas = new OffscreenCanvas(size.width, size.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        context.fillStyle = color;
        context.fillRect(0, 0, size.width, size.height);
        const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        out.push(btoa(binary));
      }
      return out;
    },
    { colors, size },
  );
  return encoded.map((base64, index) => ({
    name: `${colors[index]?.replace("#", "c") ?? "p"}-${index + 1}.png`,
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  }));
}

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

/** The colour in the middle of a GIF's first frame, decoded by the browser. */
const firstFrameColor = (page: Page, bytes: Buffer) =>
  page.evaluate(async (base64) => {
    const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([data], { type: "image/gif" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0);
    const [r, g, b] = context.getImageData(bitmap.width / 2, bitmap.height / 2, 1, 1).data;
    return [r, g, b];
  }, bytes.toString("base64"));

const loops = (bytes: Buffer) => bytes.includes("NETSCAPE2.0");

test("makes a looping GIF of four pictures in the chosen order", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await files(page).setInputFiles(
    await pictures(page, ["#ff0000", "#00ff00", "#0000ff", "#ffff00"]),
  );
  await expect(rows(page)).toHaveCount(4);
  await page.getByRole("button", { name: "Move c0000ff-3.png up" }).click();
  await page.getByRole("button", { name: "Move c0000ff-3.png up" }).click();
  await expect(rows(page).first()).toContainText("1. c0000ff-3.png");
  await make(page).click();
  await expect(result(page)).toContainText("4 frames, 480 × 360 pixels, 2 seconds a loop", {
    timeout: 60_000,
  });
  const gif = await download(page, "c0000ff-3-animation.gif");
  const facts = readMedia(gif);
  expect(facts).toMatchObject({ container: "gif", width: 480, height: 360, frames: 4 });
  expect(facts.durationSeconds).toBe(2);
  expect(loops(gif)).toBe(true);
  const [r, g, b] = await firstFrameColor(page, gif);
  expect(b).toBeGreaterThan(200);
  expect(r).toBeLessThan(50);
  expect(g).toBeLessThan(50);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("plays once, follows a tall first picture to 800 high, and checks the fields at their edges", async ({
  page,
}) => {
  await openTool(page, PATH);
  await files(page).setInputFiles([
    ...(await pictures(page, ["#ff0000"], { width: 100, height: 200 })),
    ...(await pictures(page, ["#00ff00"])),
  ]);
  const width = page.locator("#images-to-gif-width");
  const delay = page.locator("#images-to-gif-delay");
  await width.fill("801");
  await expect(page.getByText("Width must be from 50 to 800 pixels.")).toBeVisible();
  await width.fill("49");
  await expect(page.getByText("Width must be from 50 to 800 pixels.")).toBeVisible();
  await delay.fill("19");
  await expect(page.getByText("Frame delay must be from 20 to 10000 milliseconds.")).toBeVisible();
  await make(page).click();
  await expect(page.getByRole("alert")).toHaveText("Width must be from 50 to 800 pixels.");
  await delay.fill("10001");
  await expect(page.getByText("Frame delay must be from 20 to 10000 milliseconds.")).toBeVisible();
  await width.fill("800");
  await delay.fill("10000");
  await page.locator("#images-to-gif-loop").selectOption("once");
  await make(page).click();
  const once = await download(page, "cff0000-1-animation.gif");
  expect(readMedia(once)).toMatchObject({
    width: 400,
    height: 800,
    frames: 2,
    durationSeconds: 20,
  });
  expect(loops(once)).toBe(false);

  await width.fill("50");
  await delay.fill("20");
  await make(page).click();
  const fast = await download(page, "cff0000-1-animation.gif");
  expect(readMedia(fast)).toMatchObject({ width: 50, height: 100, frames: 2 });
  expect(readMedia(fast).durationSeconds).toBeCloseTo(0.04, 5);
});

test("needs two pictures, takes 100 and refuses the 101st, and makes a GIF of 100 frames", async ({
  page,
}) => {
  await openTool(page, PATH);
  const [one] = await pictures(page, ["#336699"], { width: 40, height: 30 });
  if (!one) throw new Error("no picture");
  await files(page).setInputFiles([one]);
  await make(page).click();
  await expect(page.getByRole("alert")).toHaveText("Add at least 2 pictures to make an animation.");
  const more = Array.from({ length: 100 }, (_, index) => ({ ...one, name: `p${index + 2}.png` }));
  await files(page).setInputFiles(more);
  await expect(rows(page)).toHaveCount(100);
  await expect(page.getByText("p101.png: Up to 100 pictures can go in one GIF.")).toBeVisible();
  await expect(rows(page).nth(50)).toContainText("51. p51.png");
  await page.locator("#images-to-gif-width").fill("50");
  await page.locator("#images-to-gif-delay").fill("100");
  await make(page).click();
  await expect(result(page)).toContainText("100 frames, 50 × 38 pixels, 10 seconds a loop", {
    timeout: 120_000,
  });
  const gif = await download(page, "c336699-1-animation.gif");
  expect(readMedia(gif)).toMatchObject({ frames: 100, width: 50, height: 38, durationSeconds: 10 });
});

test("refuses a picture one byte over 25 MB and uses one of exactly 25 MB", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const [small, other] = await pictures(page, ["#aa0000", "#00aa00"]);
  if (!small || !other) throw new Error("no picture");
  // Files over 50 MB in all must be given to Playwright as paths.
  const write = (name: string, buffer: Buffer) => {
    const path = testInfo.outputPath(name);
    writeFileSync(path, buffer);
    return path;
  };
  await files(page).setInputFiles([
    write("over.png", padTo(small, LIMIT + 1).buffer),
    write("full.png", padTo(small, LIMIT).buffer),
    write("other.png", other.buffer),
  ]);
  await expect(page.getByText("over.png: This file is larger than 25 MB.")).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText("1. full.png");
  await expect(rows(page).first()).toContainText("25 MB");
  await make(page).click();
  const gif = await download(page, "full-animation.gif");
  expect(readMedia(gif)).toMatchObject({ frames: 2, width: 480, height: 360 });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with frames and a GIF, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await files(page).setInputFiles(await pictures(page, ["#ff0000", "#0000ff"]));
    await make(page).click();
    await expect(result(page)).toBeVisible({ timeout: 60_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
