import { readFileSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { quickFacts } from "@networksinsights/tool-sdk";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/image/compress-image/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { makeTestPng } from "./support/test-image";
import { openTool } from "./tool-page";

// The first worker tool, in the three engines, against `wrangler dev`, so the page, its island and
// its Web Worker all run under the real Content-Security-Policy (e2e/edge.ts). A real PNG is drawn
// and encoded in the browser under test, compressed in the worker, previewed and downloaded.

test.use({ baseURL: edgeURL });

const PATH = "/compress-image/";
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const files = (page: Page) => page.locator("#compress-image-files");
const rows = (page: Page) => page.locator(".ni-fileresult");

/** Records CSP violations from before the first script runs, in the page and its worker. */
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

async function open(page: Page) {
  await openTool(page, PATH);
}

const FORMATS = {
  webp: { value: "webp", extension: "webp", magic: [0x52, 0x49, 0x46, 0x46] },
  jpg: { value: "jpg", extension: "jpg", magic: [0xff, 0xd8, 0xff] },
} as const;

/**
 * Whether this browser's canvas encoder writes WebP, asked of the browser itself. Apple's Safari
 * cannot; Playwright's WebKit on Linux, Chromium and Firefox can.
 */
const writesWebp = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL("image/webp").startsWith("data:image/webp");
  });

test("compresses a real image in the worker, previews it and downloads it", async ({
  page,
  browserName,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await open(page);
  // WebP is chosen first wherever the browser writes it.
  const format = (await writesWebp(page)) ? FORMATS.webp : FORMATS.jpg;
  await expect(page.locator("#compress-image-format")).toHaveValue(format.value);

  const image = await makeTestPng(page);
  await files(page).setInputFiles(image);

  const row = rows(page).first();
  await expect(row).toHaveAttribute("data-state", "done", { timeout: 30_000 });
  await expect(row.locator(".ni-fileresult__name")).toHaveText("test-photo.png");
  await expect(row.getByText(/% smaller$/)).toBeVisible();

  // The preview is the compressed file, from a blob: URL, and the browser decoded it.
  const preview = row.locator("img");
  await expect(preview).toHaveAttribute("src", /^blob:/);
  await expect
    .poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(1200);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    row.getByRole("button", { name: `Download test-photo-compressed.${format.extension}` }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`test-photo-compressed.${format.extension}`);
  const bytes = readFileSync((await download.path()) ?? "");
  expect([...bytes.subarray(0, format.magic.length)]).toEqual(format.magic);
  expect(bytes.length).toBeGreaterThan(1000);
  expect(bytes.length).toBeLessThan(image.buffer.length / 4);
  console.log(
    `compress-image ${browserName}: ${image.buffer.length} B PNG -> ${bytes.length} B ${format.extension}`,
  );

  // The totals agree with the row.
  await expect(page.locator('[data-stat="images"] dd')).toHaveText("1 of 1");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("writes a JPG with a white background where the PNG was transparent", async ({ page }) => {
  await open(page);
  await page.locator("#compress-image-format").selectOption("jpg");
  await files(page).setInputFiles(await makeTestPng(page));
  const row = rows(page).first();
  await expect(row).toHaveAttribute("data-state", "done", { timeout: 30_000 });
  // The test image's top-left corner is transparent: in the JPG it must be white, not black.
  const corner = await row.locator("img").evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d");
    context?.drawImage(img, 0, 0);
    return [...(context?.getImageData(10, 10, 1, 1).data ?? [])];
  });
  for (const channel of corner.slice(0, 3)) expect(channel).toBeGreaterThan(240);
});

test("offers WebP where the browser writes it", async ({ page }) => {
  await open(page);
  const webp = page.locator('#compress-image-format option[value="webp"]');
  if (await writesWebp(page)) await expect(webp).toBeEnabled();
  else await expect(webp).toBeDisabled();
});

test("offers JPG only, and says why, in a browser with no WebP encoder", async ({ page }) => {
  // What Safari does: asked for WebP, its encoder hands back a PNG.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type?: string, quality?: number) {
      return original.call(this, type === "image/webp" ? "image/png" : type, quality);
    };
  });
  await open(page);
  await expect(page.locator('#compress-image-format option[value="webp"]')).toBeDisabled();
  await expect(page.locator("#compress-image-format")).toHaveValue("jpg");
  await expect(page.getByText("This browser cannot write WebP files.")).toBeVisible();

  await files(page).setInputFiles(await makeTestPng(page));
  const row = rows(page).first();
  await expect(row).toHaveAttribute("data-state", "done", { timeout: 30_000 });
  await expect(
    row.getByRole("button", { name: "Download test-photo-compressed.jpg" }),
  ).toBeVisible();
});

test("refuses a file that is not an image, and one over the size limit, with the reason", async ({
  page,
}) => {
  await open(page);
  await files(page).setInputFiles([
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") },
    {
      name: "huge.png",
      mimeType: "image/png",
      buffer: Buffer.alloc((manifest.limits?.maxInputBytes ?? 0) + 1),
    },
  ]);
  // A warning, so a polite status rather than an interrupting alert (the Alert component).
  const alert = page.getByRole("status").filter({ hasText: "2 files were not added" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("notes.txt: This file is not a JPG, PNG or WebP image.");
  await expect(alert).toContainText("huge.png: This file is larger than 25 MB.");
  await expect(rows(page)).toHaveCount(0);
});

test("shows a clear error for a damaged image", async ({ page }) => {
  await open(page);
  await files(page).setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("this is not really a png"),
  });
  const row = rows(page).first();
  await expect(row).toHaveAttribute("data-state", "error", { timeout: 30_000 });
  await expect(row).toContainText("The browser could not read this image. It may be damaged.");
});

test("Cancel stops the work, the page stays usable, and Continue finishes it", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  await open(page);
  // Large enough, and enough of them, that the work is still going when Cancel is pressed.
  const image = await makeTestPng(page, "big.png", { width: 3000, height: 2000 });
  const names = ["one", "two", "three", "four", "five", "six"];
  // Over 50 MB in all, so the files go through disk: Playwright passes no larger buffer.
  const paths = names.map((name) => {
    const path = testInfo.outputPath(`${name}.png`);
    writeFileSync(path, image.buffer);
    return path;
  });
  await files(page).setInputFiles(paths);
  await expect(page.locator('.ni-fileresult[data-state="working"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Cancel" }).click();

  // Every file not done yet waits, marked Cancelled, and nothing starts again by itself.
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  const cancelled = rows(page).filter({ hasText: "Cancelled" });
  await expect(cancelled.first()).toBeVisible();
  const done = await page.locator('.ni-fileresult[data-state="done"]').count();
  await expect(cancelled).toHaveCount(names.length - done);
  await expect(page.locator('.ni-fileresult[data-state="working"]')).toHaveCount(0);
  await page.waitForTimeout(1000);
  await expect(page.locator('.ni-fileresult[data-state="done"]')).toHaveCount(done);

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator('.ni-fileresult[data-state="done"]')).toHaveCount(names.length, {
    timeout: 90_000,
  });
  expect(errors).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with results shown, ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await open(page);
    await files(page).setInputFiles(await makeTestPng(page));
    await expect(rows(page).first()).toHaveAttribute("data-state", "done", { timeout: 30_000 });
    const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
}

test("Quick facts are the manifest's, limits included", async ({ page }) => {
  await open(page);
  const section = page.getByRole("region", { name: "Quick facts" });
  const facts = quickFacts(manifest);
  await expect(section.locator("dt")).toHaveText(facts.map((fact) => fact.label));
  await expect(section.locator("dd")).toHaveText(facts.map((fact) => fact.value));
  await expect(section).toContainText("Up to 25 MB per input; Up to 20 files at once");
});
