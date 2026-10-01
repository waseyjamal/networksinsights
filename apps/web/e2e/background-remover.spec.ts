import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";

// Background Remover in the three engines, against `wrangler dev`, so the page, its worker, ONNX
// Runtime's WebAssembly and the model all load under the real Content-Security-Policy and headers
// (e2e/edge.ts). The test image is small and drawn in the browser: a dark red disc on white.

test.use({ baseURL: edgeURL });

const PATH = "/background-remover/";
const input = (page: Page) => page.locator("#background-remover-file");
const isModelFile = (url: string) => /\/_astro\/[^/]+\.(?:onnx|wasm)$/.test(url);

/** Records CSP violations from before the first script runs. */
async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.effectiveDirective} ${event.blockedURI} ${event.sample}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

/** A 320 by 240 PNG: a dark red disc in the middle of a plain white background. */
async function makeDiscPng(page: Page) {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.fillStyle = "white";
    context.fillRect(0, 0, 320, 240);
    context.fillStyle = "rgb(150, 20, 30)";
    context.beginPath();
    context.arc(160, 120, 70, 0, Math.PI * 2);
    context.fill();
    return canvas.toDataURL("image/png").slice("data:image/png;base64,".length);
  });
  return { name: "disc.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

async function open(page: Page) {
  await page.goto(PATH);
  await expect(page.locator("astro-island:not([ssr])")).toHaveCount(1);
}

test("removes the background of a small photo on the device and downloads a PNG", async ({
  page,
  browserName,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));

  await open(page);
  await expect(page.getByText("The first use downloads the model")).toBeVisible();
  await expect(page.getByText(/about 18 MB/).first()).toBeVisible();
  // Nothing of the model or its runtime loads with the page.
  expect(requested.filter(isModelFile)).toEqual([]);

  const started = Date.now();
  await input(page).setInputFiles(await makeDiscPng(page));
  const after = page.getByTestId("background-remover-after");
  await expect(after).toBeVisible({ timeout: 150_000 });
  console.log(`background-remover ${browserName}: first run ${Date.now() - started} ms`);

  // Model and runtime came from this site, and nothing else left the page.
  const loaded = requested.filter(isModelFile);
  expect(loaded).toHaveLength(2);
  for (const url of loaded) expect(new URL(url).origin).toBe(new URL(page.url()).origin);
  expect(
    requested.every(
      (url) => /^(blob:|data:)/.test(url) || new URL(url).origin === new URL(page.url()).origin,
    ),
  ).toBe(true);

  // The result: same size, the disc opaque and red, the white corners transparent.
  const pixels = await after.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d");
    context?.drawImage(img, 0, 0);
    const at = (x: number, y: number) => [...(context?.getImageData(x, y, 1, 1).data ?? [])];
    return { size: [img.naturalWidth, img.naturalHeight], centre: at(160, 120), corner: at(5, 5) };
  });
  expect(pixels.size).toEqual([320, 240]);
  expect(pixels.centre[3]).toBeGreaterThan(240);
  expect(pixels.centre[0]).toBeGreaterThan(100);
  expect(pixels.corner[3]).toBeLessThan(15);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download disc-no-background.png" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("disc-no-background.png");
  const bytes = readFileSync((await download.path()) ?? "");
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("cancel stops the first download and Try again starts it again", async ({ page }) => {
  await open(page);
  // Hold the model back so the job is still downloading when Cancel is pressed.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\.onnx$/, async (route) => {
    await held;
    await route.continue();
  });
  await input(page).setInputFiles(await makeDiscPng(page));
  await expect(page.getByText(/Downloading the model/).first()).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  release();
});

test("refuses a file that is not a JPG, PNG or WebP image", async ({ page }) => {
  await open(page);
  await input(page).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await expect(page.getByText("This file is not a JPG, PNG or WebP image.")).toBeVisible();
});
