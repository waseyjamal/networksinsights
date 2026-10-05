import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/video-audio/video-to-gif/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import {
  type BrowserCodecs,
  browserCodecs,
  expectProbeSane,
  hideFromPage,
  readMedia,
  recordPath,
} from "./media";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Video to GIF against `wrangler dev` (real CSP and headers). Mediabunny decodes the frames with
// the browser's WebCodecs decoder in the tool's worker and gifenc writes the GIF, from our own tiny
// clips (e2e/fixtures/README.md). Every GIF is downloaded and read back: its size, its frame count
// and its length. The clip is picked by what the browser itself says it can decode, asked here
// independently of the page; a browser that can decode neither gets the page's message instead,
// and the test records which path it took. The 30 second, 480 pixel and 15 frame limits are tested
// at the edge and one over, and at the edge for real.

test.use({ baseURL: edgeURL });
test.setTimeout(180_000);

const PATH = "/video-to-gif/";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const clips = {
  mp4: { name: "clip.mp4", mimeType: "video/mp4", buffer: fixture("clip-h264-aac.mp4") },
  webm: { name: "clip.webm", mimeType: "video/webm", buffer: fixture("clip-vp9-opus.webm") },
  longMp4: { name: "long.mp4", mimeType: "video/mp4", buffer: fixture("long-31s-h264-aac.mp4") },
  longWebm: {
    name: "long.webm",
    mimeType: "video/webm",
    buffer: fixture("long-31s-vp9-opus.webm"),
  },
};
const file = (page: Page) => page.locator("#video-to-gif-file");
const make = (page: Page) => page.getByRole("button", { name: "Make GIF" });

/** The clip this browser can decode, by what it says, or undefined when it can decode neither. */
function decodable(can: BrowserCodecs, long = false) {
  if (!can.offscreenCanvas) return undefined;
  if (can.decodeAvc) return long ? clips.longMp4 : clips.mp4;
  if (can.decodeVp9) return long ? clips.longWebm : clips.webm;
  return undefined;
}

async function download(page: Page, name: string) {
  const button = page.getByRole("button", { name: `Download ${name}` });
  await expect(button).toBeVisible({ timeout: 150_000 });
  const [saved] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(saved.suggestedFilename()).toBe(name);
  return readMedia(readFileSync((await saved.path()) ?? ""));
}

test("makes a GIF from a clip the browser decodes, or says plainly that it cannot", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expectProbeSane(page);
  const clip = decodable(await browserCodecs(page));
  if (!clip) {
    await file(page).setInputFiles(clips.mp4);
    await expect(page.locator("#video-to-gif-support")).toContainText(
      "this tool cannot make a GIF",
    );
    await expect(make(page)).toBeDisabled();
    recordPath(testInfo, "clip to GIF", "message");
  } else {
    await file(page).setInputFiles(clip);
    await expect(page.locator("#video-to-gif-source")).toContainText("320 × 240 pixels");
    // The defaults ask for 5 seconds at 10 frames a second; the clip has 2.
    await expect(page.locator("#video-to-gif-plan")).toContainText("20 frames, 320 × 240 pixels");
    await make(page).click();
    const gif = await download(page, "clip.gif");
    expect(gif.container).toBe("gif");
    expect([gif.width, gif.height]).toEqual([320, 240]);
    expect(gif.frames).toBe(20);
    expect(gif.durationSeconds).toBeCloseTo(2, 5);
    await expect(page.locator("#video-to-gif-result img")).toBeVisible();
    recordPath(testInfo, `${clip.name} to GIF`, "real");
  }
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("refuses one over each limit, and makes a GIF at exactly 30 s, 480 px and 15 frames", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  await expectProbeSane(page);
  const clip = decodable(await browserCodecs(page), true);
  if (!clip) {
    await file(page).setInputFiles(clips.longMp4);
    await expect(page.locator("#video-to-gif-support")).toBeVisible();
    recordPath(testInfo, "limits", "message");
    return;
  }
  await file(page).setInputFiles(clip);
  await expect(page.locator("#video-to-gif-source")).toContainText("31 s, 64 × 48 pixels");
  const length = page.locator("#video-to-gif-length");
  const width = page.locator("#video-to-gif-width");
  const fps = page.locator("#video-to-gif-fps");
  const start = page.locator("#video-to-gif-start");

  await length.fill("30.1");
  await expect(page.getByText("Enter a length from 0.1 to 30 seconds.")).toBeVisible();
  await expect(make(page)).toBeDisabled();
  await length.fill("30");
  await width.fill("481");
  await expect(page.getByText("Enter a width from 16 to 480 pixels.")).toBeVisible();
  await expect(make(page)).toBeDisabled();
  await width.fill("480");
  await fps.fill("16");
  await expect(page.getByText("Enter a frame rate from 1 to 15 frames a second.")).toBeVisible();
  await expect(make(page)).toBeDisabled();
  await fps.fill("15");
  await start.fill("31.5");
  await expect(page.getByText("The start must be before the end of the video")).toBeVisible();
  await start.fill("0");
  await expect(page.locator("#video-to-gif-plan")).toContainText("450 frames, 480 × 360 pixels");
  await expect(make(page)).toBeEnabled();

  await make(page).click();
  const gif = await download(page, "long.gif");
  expect([gif.width, gif.height]).toEqual([480, 360]);
  expect(gif.frames).toBe(450);
  // 15 frames a second is stored as 7 hundredths of a second a frame.
  expect(gif.durationSeconds).toBeCloseTo(450 * 0.07, 5);
  recordPath(testInfo, "limits at the edge", "real");
});

test("Cancel stops a GIF in progress and saves nothing", async ({ page }, testInfo) => {
  await openTool(page, PATH);
  await expectProbeSane(page);
  const clip = decodable(await browserCodecs(page), true);
  if (!clip) {
    await file(page).setInputFiles(clips.longMp4);
    await expect(page.locator("#video-to-gif-support")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    recordPath(testInfo, "cancel", "message");
    return;
  }
  await file(page).setInputFiles(clip);
  await page.locator("#video-to-gif-length").fill("30");
  await page.locator("#video-to-gif-width").fill("480");
  await page.locator("#video-to-gif-fps").fill("15");
  await make(page).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Stopped. Nothing was saved.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download long.gif" })).toHaveCount(0);
  await expect(make(page)).toBeEnabled();
  recordPath(testInfo, "cancel", "real");
});

test("without a video decoder, says plainly that it cannot make a GIF here", async ({ page }) => {
  recordPath(
    test.info(),
    "without a video decoder, says plainly that it cannot make a GIF here, no conversion",
    "message",
  );
  await hideFromPage(page, ["VideoDecoder", "VideoEncoder", "AudioEncoder"]);
  const errors = collectErrors(page);
  await openTool(page, PATH);
  expect(await page.evaluate(() => typeof VideoDecoder)).toBe("undefined");
  await file(page).setInputFiles(clips.mp4);
  await expect(page.locator("#video-to-gif-support")).toContainText("this tool cannot make a GIF");
  await expect(make(page)).toBeDisabled();
  expect(errors).toEqual([]);
});

test("refuses a file that is not a video", async ({ page }) => {
  recordPath(test.info(), "refuses a file that is not a video, no conversion", "message");
  await openTool(page, PATH);
  await file(page).setInputFiles({
    name: "cat.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("GIF89a"),
  });
  await expect(page.getByRole("status")).toContainText(
    "cat.gif: This file is not a video this tool reads.",
  );
  await expect(make(page)).toBeDisabled();
});

for (const theme of ["light", "dark"] as const) {
  test(`has no axe violations after reading a video, ${theme} theme`, async ({ page }) => {
    recordPath(
      test.info(),
      `has no axe violations after reading a video, ${theme} theme, no conversion`,
      "message",
    );
    await useTheme(page, theme);
    await openTool(page, PATH);
    const clip = decodable(await browserCodecs(page)) ?? clips.mp4;
    await file(page).setInputFiles(clip);
    await expect(page.locator("#video-to-gif-source")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts come from the manifest", async ({ page }) => {
  recordPath(
    test.info(),
    "structured data and Quick facts come from the manifest, no conversion",
    "message",
  );
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
  await expect(page.getByRole("region", { name: "Quick facts" })).toContainText("Up to 200 MB");
});
