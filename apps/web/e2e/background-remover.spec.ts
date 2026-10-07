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
// Limits (ADR 0066). The first limits (mean under 0.5 levels, 99.5% of pixels within 2, none over
// 16) failed on the first browser run, and were replaced after it, on measurements: this 8-bit
// model turns a difference in the last bit of a float32 input into up to 142 levels on x64 alone
// (the noise floor), and those pixels all lie within 41 px of the person's outline, for the
// browser and for the noise floor alike. So the check is strict away from the outline and bounded
// near it:
// - more than 48 px from the outline (the 0.5 contour of the reference matte): none over 16;
// - within 48 px: at most 9,000 pixels over 16 (browser 6,276, noise floor 6,224);
// - mean at most 1.5 levels (noise floor 1.08), at least 90% within 2 levels (noise floor 93.18%);
// - the same browser on the same input twice gives the identical result.
const EDGE_BAND = 48;
const MAX_LEVELS = 16;
const MAX_OVER_IN_BAND = 9000;
const MAX_MEAN_LEVELS = 1.5;
const CLOSE_SHARE = 0.9;

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

const BOXES: Record<string, Box> = {
  topLeft: [0, 0, 64, 64],
  topRight: [448, 0, 512, 64],
  face: [220, 130, 290, 210],
  suit: [200, 300, 380, 380],
  helmet: [40, 420, 220, 600],
};

/**
 * The result's alpha against the reference matte, measured by distance from the reference's
 * outline (alpha 128 and over is the person; 4-neighbour city-block distance in two passes, so it
 * is exact and the same on every run), the mean alpha inside some boxes, and the alpha itself as
 * text, to compare two runs.
 */
function readAlpha(page: Page, result: Buffer, matte: Buffer) {
  return page.evaluate(
    async ([a, b, regions, band, levels]) => {
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
      const [x, y] = [await decode(a), await decode(b)];
      const w = x.width;
      const h = x.height;
      const n = w * h;
      const alpha = (i: number) => x.data?.[i * 4 + 3] ?? 0;
      // The matte is greyscale: its red channel is the reference alpha.
      const ref = (i: number) => y.data?.[i * 4] ?? 0;
      const person = (i: number) => ref(i) >= 128;
      const distance = new Int32Array(n).fill(1 << 30);
      for (let i = 0; i < n; i++) {
        const r = Math.floor(i / w);
        const c = i % w;
        if (
          (r > 0 && person(i - w) !== person(i)) ||
          (r < h - 1 && person(i + w) !== person(i)) ||
          (c > 0 && person(i - 1) !== person(i)) ||
          (c < w - 1 && person(i + 1) !== person(i))
        ) {
          distance[i] = 0;
        }
      }
      for (let i = 0; i < n; i++) {
        let v = distance[i] ?? 0;
        if (i >= w) v = Math.min(v, (distance[i - w] ?? 0) + 1);
        if (i % w > 0) v = Math.min(v, (distance[i - 1] ?? 0) + 1);
        distance[i] = v;
      }
      for (let i = n - 1; i >= 0; i--) {
        let v = distance[i] ?? 0;
        if (i + w < n) v = Math.min(v, (distance[i + w] ?? 0) + 1);
        if (i % w < w - 1) v = Math.min(v, (distance[i + 1] ?? 0) + 1);
        distance[i] = v;
      }
      let sum = 0;
      let close = 0;
      let maxBeyond = 0;
      let overInBand = 0;
      let farthestOver = 0;
      const text: string[] = [];
      for (let i = 0; i < n; i++) {
        const d = Math.abs(alpha(i) - ref(i));
        const far = distance[i] ?? 0;
        sum += d;
        if (d <= 2) close++;
        if (far > band) maxBeyond = Math.max(maxBeyond, d);
        if (d > levels) {
          if (far <= band) overInBand++;
          farthestOver = Math.max(farthestOver, far);
        }
        text.push(String.fromCharCode(alpha(i)));
      }
      const means: Record<string, number> = {};
      for (const [name, [x0, y0, x1, y1]] of Object.entries(regions)) {
        let total = 0;
        for (let r = y0; r < y1; r++) {
          for (let c = x0; c < x1; c++) total += alpha(r * w + c);
        }
        means[name] = total / 255 / ((x1 - x0) * (y1 - y0));
      }
      return {
        size: [w, h],
        expectedSize: [y.width, y.height],
        maxBeyond,
        overInBand,
        farthestOver,
        mean: sum / n,
        closeShare: close / n,
        means,
        alpha: text.join(""),
      };
    },
    [result.toString("base64"), matte.toString("base64"), BOXES, EDGE_BAND, MAX_LEVELS] as const,
  );
}

/** Drops the portrait, waits for the result, downloads it and reads it. */
async function removeOnce(page: Page) {
  await input(page).setInputFiles(png("astronaut.png", fixture("portrait.png")));
  await expect(row(page)).toHaveAttribute("data-state", "done", { timeout: 240_000 });
  await expect(row(page)).toContainText("512 × 640 pixels");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    row(page).getByRole("button", { name: "Download PNG" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("astronaut-no-background.png");
  const result = readFileSync((await download.path()) ?? "");
  return readAlpha(page, result, fixture("portrait-matte.png"));
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
  const read = await removeOnce(page);
  const { alpha, ...numbers } = read;
  console.log(`background-remover: ${JSON.stringify(numbers)}`);
  expect(read.size).toEqual([512, 640]);
  expect(read.expectedSize).toEqual([512, 640]);
  expect(read.maxBeyond).toBeLessThanOrEqual(MAX_LEVELS);
  expect(read.farthestOver).toBeLessThanOrEqual(EDGE_BAND);
  expect(read.overInBand).toBeLessThanOrEqual(MAX_OVER_IN_BAND);
  expect(read.mean).toBeLessThanOrEqual(MAX_MEAN_LEVELS);
  expect(read.closeShare).toBeGreaterThanOrEqual(CLOSE_SHARE);
  // What the page's example says about this photo.
  expect(read.means.topLeft).toBeLessThanOrEqual(0.01);
  expect(read.means.topRight).toBeLessThanOrEqual(0.01);
  expect(read.means.face).toBeGreaterThanOrEqual(0.99);
  expect(read.means.suit).toBeGreaterThanOrEqual(0.99);
  expect(read.means.helmet).toBeGreaterThan(0.1);
  expect(read.means.helmet).toBeLessThan(0.9);

  // The same photo again, in the same browser: the identical result.
  const again = await removeOnce(page);
  expect(again.alpha.length).toBe(512 * 640);
  expect(again.alpha === alpha).toBe(true);

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
