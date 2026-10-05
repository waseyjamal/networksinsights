import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { readMp3 } from "../../../tools/video-audio/video-to-mp3/logic";
import manifest from "../../../tools/video-audio/video-to-mp3/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { browserCodecs, expectProbeSane, hideFromPage, recordPath } from "./media";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Video to MP3 against `wrangler dev` (real CSP and headers). Mediabunny decodes the sound with the
// browser's WebCodecs decoder in the tool's worker, and LAME encodes it, fetched as its own
// unmodified file from /vendor/wasm-media-encoders/ (ADR 0064). Every MP3 is downloaded and its
// frame headers are read back. What the browser can decode is asked of the browser here,
// independently of the page: a real MP3 where it can, the page's honest message where it cannot.

test.use({ baseURL: edgeURL });
test.setTimeout(120_000);

const PATH = "/video-to-mp3/";
const WASM = "/vendor/wasm-media-encoders/0.7.0/mp3.wasm";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const MP4 = { name: "clip.mp4", mimeType: "video/mp4", buffer: fixture("clip-h264-aac.mp4") };
const WEBM = { name: "clip.webm", mimeType: "video/webm", buffer: fixture("clip-vp9-opus.webm") };
const file = (page: Page) => page.locator("#video-to-mp3-file");

async function encode(page: Page, bitrate: string, name: string) {
  await page.locator("#video-to-mp3-bitrate").selectOption(bitrate);
  await page.getByRole("button", { name: "Make MP3" }).click();
  const button = page.getByRole("button", { name: `Download ${name}` });
  await expect(button).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toBe(name);
  return readMp3(new Uint8Array(readFileSync((await download.path()) ?? "")));
}

test("makes a real MP3 from the AAC sound of an MP4, with LAME from its vendored file", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  const can = await browserCodecs(page);
  await expectProbeSane(page);
  await file(page).setInputFiles(MP4);
  await expect(page.locator("#video-to-mp3-source")).toContainText("clip.mp4");
  await expect(page.locator("#video-to-mp3-source")).toContainText("0:02");

  if (can.decodeAac) {
    const wasm = page.waitForResponse((response) => response.url().endsWith(WASM));
    const mp3 = await encode(page, "192", "clip.mp3");
    const response = await wasm;
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/wasm");
    expect(mp3).not.toBeNull();
    expect(mp3?.sampleRate).toBe(48_000);
    expect(mp3?.channels).toBe(2);
    expect(mp3?.bitrates).toEqual([192]);
    expect(mp3?.durationSeconds).toBeGreaterThan(1.95);
    expect(mp3?.durationSeconds).toBeLessThan(2.15);
    recordPath(testInfo, "MP4 (AAC) to MP3 at 192 kbit/s", "real");
  } else {
    await expect(page.locator("#video-to-mp3-support")).toContainText(
      "Your browser cannot decode the sound in this video",
    );
    recordPath(testInfo, "MP4 (AAC) to MP3", "message");
  }
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("makes an MP3 from the Opus sound of a WebM where the browser decodes it", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  await openTool(page, PATH);
  const can = await browserCodecs(page);
  await file(page).setInputFiles(WEBM);
  await expect(page.locator("#video-to-mp3-source")).toContainText("clip.webm");
  if (can.decodeOpus) {
    await expect(page.locator("#video-to-mp3-bitrate")).toBeVisible();
    const mp3 = await encode(page, "128", "clip.mp3");
    expect(mp3?.bitrates).toEqual([128]);
    expect(mp3?.sampleRate).toBe(48_000);
    expect(mp3?.durationSeconds).toBeGreaterThan(1.95);
    expect(mp3?.durationSeconds).toBeLessThan(2.15);
    recordPath(testInfo, "WebM (Opus) to MP3 at 128 kbit/s", "real");
  } else {
    await expect(page.locator("#video-to-mp3-support")).toContainText(
      "Your browser cannot decode the sound in this video",
    );
    recordPath(testInfo, "WebM (Opus) to MP3", "message");
  }
  expect(errors).toEqual([]);
});

test("with no WebCodecs decoder, says it cannot and offers nothing", async ({ page }) => {
  recordPath(test.info(), "with no WebCodecs decoder, no conversion", "message");
  await hideFromPage(page, ["AudioEncoder", "AudioDecoder"]);
  const errors = collectErrors(page);
  await openTool(page, PATH);
  expect(await page.evaluate(() => typeof AudioDecoder)).toBe("undefined");
  await file(page).setInputFiles(MP4);
  await expect(page.locator("#video-to-mp3-support")).toContainText(
    "Your browser cannot decode the sound in this video, so it cannot make an MP3 of it here.",
  );
  await expect(page.getByRole("button", { name: "Make MP3" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("refuses a file that is not a video, and one that cannot be read", async ({ page }) => {
  recordPath(test.info(), "refuses files, no conversion", "message");
  await openTool(page, PATH);
  await file(page).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("text"),
  });
  await expect(page.getByRole("status")).toContainText(
    "notes.txt: This file is not a video this tool reads.",
  );
  await file(page).setInputFiles({
    name: "broken.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("not a video at all, just some bytes"),
  });
  await expect(page.getByRole("status")).toContainText("broken.mp4: This file is not a video");
  await expect(page.getByRole("button", { name: "Make MP3" })).toBeDisabled();
});

for (const theme of ["light", "dark"] as const) {
  test(`has no axe violations with a video chosen, ${theme} theme`, async ({ page }) => {
    recordPath(test.info(), `axe, ${theme} theme, no conversion`, "message");
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(MP4);
    await expect(page.locator("#video-to-mp3-source")).toContainText("clip.mp4");
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts come from the manifest", async ({ page }) => {
  recordPath(test.info(), "structured data and Quick facts, no conversion", "message");
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
  await expect(page.getByRole("region", { name: "Quick facts" })).toContainText("Up to 1 GB");
});
