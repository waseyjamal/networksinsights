import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { ENGINE, MESSAGES, MODEL } from "../../../tools/image/image-upscaler/logic";
import manifest from "../../../tools/image/image-upscaler/tool.config";
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

// Image Upscaler against `wrangler dev` (real CSP and headers): the worker loads ONNX Runtime
// Web's wasm from /vendor/onnxruntime-web/ and the Real-ESRGAN model from /models/, checks the
// model's SHA-256 and upscales a real photo crop (e2e/fixtures/README.md) in two tiles. The result
// is read back pixel by pixel and compared with the output of the original PyTorch model on the
// whole picture at once (scripts/models/make-fixtures.py), so the test proves the conversion, the
// engine, the tiling and the stitching together.
//
// Tolerances, fixed before the first browser run and never to be raised after a failure (ADR
// 0066): convert-realesrgan.py measured onnxruntime against PyTorch at most 1 level of 255 apart
// on any channel. One more level is allowed for float rounding differences between the native and
// the WebAssembly kernels, so at most 2 levels on any channel, and a mean under 0.05 levels.
const MAX_LEVELS = 2;
const MAX_MEAN_LEVELS = 0.05;

test.use({ baseURL: edgeURL });
// One thread of WebAssembly, three browsers: the upscale itself takes tens of seconds.
test.setTimeout(300_000);

const PATH = "/image-upscaler/";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const png = (name: string, buffer: Buffer) => ({ name, mimeType: "image/png", buffer });
const input = (page: Page) => page.locator("#image-upscaler-file");
const row = (page: Page) => page.locator(".ni-fileresult").first();

/** Every request the page and its worker make, by path, and any to another origin. */
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

/** Decodes two PNGs in the page and compares their pixels: size, largest and mean difference. */
function compare(page: Page, actual: Buffer, expected: Buffer) {
  return page.evaluate(
    async ([a, b]) => {
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
      const [x, y] = [await decode(a ?? ""), await decode(b ?? "")];
      let max = 0;
      let sum = 0;
      let count = 0;
      let opaque = true;
      if (x.data && y.data && x.data.length === y.data.length) {
        for (let i = 0; i < x.data.length; i += 4) {
          for (let c = 0; c < 3; c++) {
            const d = Math.abs((x.data[i + c] ?? 0) - (y.data[i + c] ?? 0));
            max = Math.max(max, d);
            sum += d;
            count++;
          }
          if (x.data[i + 3] !== 255) opaque = false;
        }
      }
      return {
        size: [x.width, x.height],
        expectedSize: [y.width, y.height],
        max,
        mean: count ? sum / count : Number.NaN,
        opaque,
      };
    },
    [actual.toString("base64"), expected.toString("base64")],
  );
}

test("upscales a real photo 4 times, matching the PyTorch model, with files from this site only", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  const requests = watchRequests(page);
  await openTool(page, PATH);
  await expect(page.locator("#image-upscaler-download")).toHaveText(
    "The first run downloads 18.2 MB: the model and the engine that runs it. Your browser keeps them for the next picture.",
  );
  await input(page).setInputFiles(png("face.png", fixture("upscale-face.png")));
  await expect(row(page)).toHaveAttribute("data-state", "done", { timeout: 240_000 });
  await expect(row(page)).toContainText("896 × 384 pixels");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    row(page).getByRole("button", { name: "Download PNG" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("face-4x.png");
  const result = readFileSync((await download.path()) ?? "");
  const diff = await compare(page, result, fixture("upscale-face-4x.png"));
  console.log(`image-upscaler: ${JSON.stringify(diff)}`);
  expect(diff.size).toEqual([896, 384]);
  expect(diff.expectedSize).toEqual([896, 384]);
  expect(diff.max).toBeLessThanOrEqual(MAX_LEVELS);
  expect(diff.mean).toBeLessThan(MAX_MEAN_LEVELS);
  expect(diff.opaque).toBe(true);

  // The engine and the model came from this site, the model from its hash-named path.
  expect(requests.paths).toContain(MODEL.url);
  expect(requests.paths).toContain(`${ENGINE.base}${ENGINE.wasm}`);
  expect(requests.paths).toContain(`${ENGINE.base}${ENGINE.mjs}`);
  expect(requests.paths.some((path) => /jsep|jspi|asyncify|webgpu/.test(path))).toBe(false);
  expect(requests.foreign).toEqual([]);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("serves the model and the engine with a year's cache and the right types", async ({
  request,
}) => {
  // The model is read as bytes, so its media type does not matter: the static server sets none
  // for .onnx. The engine's files must have theirs, or the browser refuses to compile or import.
  for (const [path, type] of [
    [MODEL.url, undefined],
    [`${ENGINE.base}${ENGINE.wasm}`, "application/wasm"],
    [`${ENGINE.base}${ENGINE.mjs}`, "javascript"],
  ] as const) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["cache-control"], path).toBe("public, max-age=31536000, immutable");
    if (type) expect(response.headers()["content-type"], path).toContain(type);
  }
  const model = await request.get(MODEL.url);
  expect((await model.body()).length).toBe(MODEL.bytes);
});

test("refuses a picture over 1 megapixel before loading the model, and takes 1 megapixel", async ({
  page,
}) => {
  const requests = watchRequests(page);
  await openTool(page, PATH);
  /** A plain PNG of this size, drawn by the browser. */
  const blank = async (width: number, height: number) =>
    Buffer.from(
      await page.evaluate(
        async ([w, h]) => {
          const canvas = document.createElement("canvas");
          canvas.width = w ?? 1;
          canvas.height = h ?? 1;
          const context = canvas.getContext("2d");
          if (context) context.fillStyle = "#808080";
          context?.fillRect(0, 0, w ?? 1, h ?? 1);
          const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
          const bytes = new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0));
          let text = "";
          for (const byte of bytes) text += String.fromCharCode(byte);
          return btoa(text);
        },
        [width, height],
      ),
      "base64",
    );
  // Playwright's desktop browsers have a mouse, and Safari and Firefox report no deviceMemory:
  // that is the computer's limit, not a phone's.
  await input(page).setInputFiles(png("big.png", await blank(1001, 1000)));
  await expect(page.locator("#image-upscaler-error")).toHaveText(
    MESSAGES.tooManyPixels(1001, 1000, 1_000_000),
    { timeout: 60_000 },
  );
  expect(requests.paths.some((path) => path.startsWith("/models/"))).toBe(false);
  await expect(page.getByText("and 1 megapixels on this device")).toBeVisible();
});

test("refuses a file that is not a picture", async ({ page }) => {
  await openTool(page, PATH);
  await input(page).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("text"),
  });
  await expect(page.locator("#image-upscaler-error")).toHaveText(MESSAGES.notImage);
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
    await expect(page.locator("#image-upscaler-error")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts are the manifest's", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
