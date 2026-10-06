import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { ENGINE, MESSAGES, MODEL } from "../../../tools/image/background-remover/logic";
import manifest from "../../../tools/image/background-remover/tool.config";
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

// Background Remover against `wrangler dev` (real CSP and headers): the worker loads ONNX Runtime
// Web's wasm from /vendor/onnxruntime-web/ and the MODNet model from /models/, checks its SHA-256
// and removes the background of a real portrait (e2e/fixtures/README.md). The fixture is already
// the size the model sees, 512 × 640, so the browser's alpha can be compared with the matte that
// onnxruntime gives for the same model on the same pixels (scripts/models/make-fixtures.py), and
// with what the page's example says: face and suit opaque, top corners transparent, the helmet
// only partly kept.
//
// Tolerances, fixed before the first browser run and never to be raised after a failure (ADR
// 0066). make-fixtures.py found no difference between onnxruntime's optimised and plain graphs
// (0 levels), and the Real-ESRGAN conversion found PyTorch and onnxruntime at most 1 level apart.
// This model is 8-bit quantised, so one rounding step inside it can move a few pixels further:
// the mean difference must stay under 0.5 levels, 99.5% of pixels within 2 levels, none over 16.
const MAX_MEAN_LEVELS = 0.5;
const CLOSE_SHARE = 0.995;
const MAX_LEVELS = 16;

test.use({ baseURL: edgeURL });
test.setTimeout(300_000);

const PATH = "/background-remover/";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const png = (name: string, buffer: Buffer) => ({ name, mimeType: "image/png", buffer });
const input = (page: Page) => page.locator("#background-remover-file");
const row = (page: Page) => page.locator(".ni-fileresult").first();

function watchRequests(page: Page) {
  const paths: string[] = [];
  const foreign: string[] = [];
  page.context().on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === new URL(edgeURL).origin) paths.push(url.pathname);
    else if (url.protocol.startsWith("http")) foreign.push(request.url());
  });
  return { paths, foreign };
}

type Box = [number, number, number, number];

/** The result's alpha against the reference matte, and the mean alpha inside some boxes. */
function readAlpha(page: Page, result: Buffer, matte: Buffer, boxes: Record<string, Box>) {
  return page.evaluate(
    async ([a, b, regions]) => {
      const decode = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }), {
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
        });
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context?.drawImage(bitmap, 0, 0);
        const data = context?.getImageData(0, 0, bitmap.width, bitmap.height).data;
        return { width: bitmap.width, height: bitmap.height, data };
      };
      const [x, y] = [await decode(a as string), await decode(b as string)];
      let max = 0;
      let sum = 0;
      let close = 0;
      const pixels = x.width * x.height;
      const alpha = (i: number) => x.data?.[i * 4 + 3] ?? 0;
      if (x.data && y.data && x.data.length === y.data.length) {
        for (let i = 0; i < pixels; i++) {
          // The matte is greyscale: its red channel is the reference alpha.
          const d = Math.abs(alpha(i) - (y.data[i * 4] ?? 0));
          max = Math.max(max, d);
          sum += d;
          // Within 2 levels: the CLOSE_SHARE rule above.
          if (d <= 2) close++;
        }
      }
      const means: Record<string, number> = {};
      for (const [name, [x0, y0, x1, y1]] of Object.entries(regions as Record<string, number[]>)) {
        let total = 0;
        for (let row = y0 ?? 0; row < (y1 ?? 0); row++) {
          for (let col = x0 ?? 0; col < (x1 ?? 0); col++) total += alpha(row * x.width + col);
        }
        means[name] = total / 255 / (((x1 ?? 0) - (x0 ?? 0)) * ((y1 ?? 0) - (y0 ?? 0)));
      }
      return {
        size: [x.width, x.height],
        expectedSize: [y.width, y.height],
        max,
        mean: sum / pixels,
        closeShare: close / pixels,
        means,
      };
    },
    [result.toString("base64"), matte.toString("base64"), boxes] as const,
  );
}

test("removes the background of a real portrait, matching the model, with files from this site only", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  const requests = watchRequests(page);
  await openTool(page, PATH);
  await expect(page.getByText("Best for people", { exact: true })).toBeVisible();
  await expect(page.locator("#background-remover-download")).toHaveText(
    "The first run downloads 19.9 MB: the model and the engine that runs it. Your browser keeps them for the next picture.",
  );
  await input(page).setInputFiles(png("astronaut.png", fixture("portrait.png")));
  await expect(row(page)).toHaveAttribute("data-state", "done", { timeout: 240_000 });
  await expect(row(page)).toContainText("512 × 640 pixels");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    row(page).getByRole("button", { name: "Download PNG" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("astronaut-no-background.png");
  const result = readFileSync((await download.path()) ?? "");
  const read = await readAlpha(page, result, fixture("portrait-matte.png"), {
    topLeft: [0, 0, 64, 64],
    topRight: [448, 0, 512, 64],
    face: [220, 130, 290, 210],
    suit: [200, 300, 380, 380],
    helmet: [40, 420, 220, 600],
  });
  console.log(`background-remover: ${JSON.stringify(read)}`);
  expect(read.size).toEqual([512, 640]);
  expect(read.expectedSize).toEqual([512, 640]);
  expect(read.mean).toBeLessThan(MAX_MEAN_LEVELS);
  expect(read.closeShare).toBeGreaterThanOrEqual(CLOSE_SHARE);
  expect(read.max).toBeLessThanOrEqual(MAX_LEVELS);
  // What the page's example says about this photo.
  expect(read.means.topLeft).toBeLessThanOrEqual(0.01);
  expect(read.means.topRight).toBeLessThanOrEqual(0.01);
  expect(read.means.face).toBeGreaterThanOrEqual(0.99);
  expect(read.means.suit).toBeGreaterThanOrEqual(0.99);
  expect(read.means.helmet).toBeGreaterThan(0.1);
  expect(read.means.helmet).toBeLessThan(0.9);

  expect(requests.paths).toContain(MODEL.url);
  expect(requests.paths).toContain(`${ENGINE.base}${ENGINE.wasm}`);
  expect(requests.paths.some((path) => /jsep|jspi|asyncify|webgpu/.test(path))).toBe(false);
  expect(requests.foreign).toEqual([]);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("refuses a file that is not a picture, and one over 24 megapixels before loading the model", async ({
  page,
}) => {
  const requests = watchRequests(page);
  await openTool(page, PATH);
  await input(page).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("text"),
  });
  await expect(page.locator("#background-remover-error")).toHaveText(MESSAGES.notImage);

  // A PNG whose header says 6,000 × 4,001: one row over 24 megapixels. The browser reads the size
  // from the header, so the picture is refused before its pixels or the model are loaded.
  const big = Buffer.from(
    await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 6000;
      canvas.height = 4001;
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
      const bytes = new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0));
      let text = "";
      for (const byte of bytes) text += String.fromCharCode(byte);
      return btoa(text);
    }),
    "base64",
  );
  await input(page).setInputFiles(png("big.png", big));
  await expect(page.locator("#background-remover-error")).toHaveText(
    MESSAGES.tooManyPixels(6000, 4001),
    { timeout: 60_000 },
  );
  expect(requests.paths.some((path) => path.startsWith("/models/"))).toBe(false);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await input(page).setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("text"),
    });
    await expect(page.locator("#background-remover-error")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts are the manifest's", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
