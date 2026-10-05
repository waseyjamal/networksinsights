import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/video-audio/video-to-audio/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { browserCodecs, expectProbeSane, hideFromPage, readMedia, recordPath } from "./media";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Video to audio against `wrangler dev` (real CSP and headers). Mediabunny runs in the tool's
// worker on our own tiny clips (e2e/fixtures/README.md). Every result is downloaded and read back:
// its container header, its codec and its length. What the browser can do is asked of the browser
// here, independently of the page, and the test expects exactly that: a real file where the
// browser can write one, the page's honest message where it cannot. Copying AAC into M4A needs no
// codec, so it runs for real in every browser.

test.use({ baseURL: edgeURL });
test.setTimeout(120_000);

const PATH = "/video-to-audio/";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const MP4 = { name: "clip.mp4", mimeType: "video/mp4", buffer: fixture("clip-h264-aac.mp4") };
const WEBM = { name: "clip.webm", mimeType: "video/webm", buffer: fixture("clip-vp9-opus.webm") };
const file = (page: Page) => page.locator("#video-to-audio-file");

async function extract(page: Page, output: "m4a" | "wav", name: string) {
  await page.locator("#video-to-audio-output").selectOption(output);
  await page.getByRole("button", { name: "Extract audio" }).click();
  const button = page.getByRole("button", { name: `Download ${name}` });
  await expect(button).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toBe(name);
  return readMedia(readFileSync((await download.path()) ?? ""));
}

test("copies the AAC sound of an MP4 into M4A without re-encoding, in every browser", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(MP4);
  await expect(page.locator("#video-to-audio-source")).toContainText("clip.mp4");
  await expect(page.locator("#video-to-audio-source")).toContainText("0:02");
  const facts = await extract(page, "m4a", "clip.m4a");
  expect(facts.container).toBe("mp4");
  expect(facts.codecs).toEqual(["mp4a"]);
  expect(facts.durationSeconds).toBeGreaterThan(1.9);
  expect(facts.durationSeconds).toBeLessThan(2.1);
  await expect(page.locator("#video-to-audio-result")).toContainText("copied without re-encoding");
  recordPath(testInfo, "MP4 (AAC) to M4A, copied", "real");
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("saves WAV when the browser decodes the sound, and says so when it cannot", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const can = await browserCodecs(page);
  await expectProbeSane(page);
  for (const [clip, decodes] of [
    [MP4, can.decodeAac],
    [WEBM, can.decodeOpus],
  ] as const) {
    await file(page).setInputFiles(clip);
    await expect(page.locator("#video-to-audio-source")).toContainText(clip.name);
    if (decodes) {
      const facts = await extract(page, "wav", clip.name.replace(/\.\w+$/, ".wav"));
      expect(facts.container).toBe("wav");
      expect(facts.sampleRate).toBe(48_000);
      expect(facts.channels).toBe(2);
      expect(facts.durationSeconds).toBeGreaterThan(1.9);
      expect(facts.durationSeconds).toBeLessThan(2.1);
      recordPath(testInfo, `${clip.name} to WAV`, "real");
    } else {
      await expect(page.locator('[data-unavailable="wav"]')).toContainText(
        "Your browser cannot decode this sound.",
      );
      recordPath(testInfo, `${clip.name} to WAV`, "message");
    }
  }
});

test("re-encodes Opus from a WebM as AAC where the browser can, and explains it where not", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const can = await browserCodecs(page);
  await expectProbeSane(page);
  await file(page).setInputFiles(WEBM);
  await expect(page.locator("#video-to-audio-source")).toContainText("sound: opus");
  if (can.decodeOpus && can.encodeAac) {
    const facts = await extract(page, "m4a", "clip.m4a");
    expect(facts.codecs).toEqual(["mp4a"]);
    expect(facts.durationSeconds).toBeGreaterThan(1.9);
    expect(facts.durationSeconds).toBeLessThan(2.2);
    await expect(page.locator("#video-to-audio-result")).not.toContainText("copied");
    recordPath(testInfo, "WebM (Opus) to M4A, re-encoded", "real");
  } else {
    await expect(page.locator('[data-unavailable="m4a"]')).toContainText("is not offered");
    recordPath(testInfo, "WebM (Opus) to M4A, re-encoded", "message");
  }
});

test("with no WebCodecs audio at all, offers only the AAC copy, or says it cannot", async ({
  page,
}) => {
  recordPath(
    test.info(),
    "with no WebCodecs audio at all, offers only the AAC copy, or says it cannot, no conversion",
    "message",
  );
  await hideFromPage(page, ["AudioEncoder", "AudioDecoder"]);
  const errors = collectErrors(page);
  await openTool(page, PATH);
  expect(await page.evaluate(() => typeof AudioEncoder)).toBe("undefined");

  await file(page).setInputFiles(WEBM);
  await expect(page.locator("#video-to-audio-support")).toContainText(
    "Your browser cannot decode or encode the sound in this video",
  );
  await expect(page.getByRole("button", { name: "Extract audio" })).toBeDisabled();

  await file(page).setInputFiles(MP4);
  await expect(page.locator("#video-to-audio-output option")).toHaveText(["M4A (AAC)"]);
  await expect(page.locator('[data-unavailable="wav"]')).toContainText(
    "Your browser cannot decode this sound.",
  );
  expect(errors).toEqual([]);
});

test("refuses a file that is not a video, and one that cannot be read", async ({ page }) => {
  recordPath(
    test.info(),
    "refuses a file that is not a video, and one that cannot be read, no conversion",
    "message",
  );
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
  await expect(page.getByRole("button", { name: "Extract audio" })).toBeDisabled();
});

for (const theme of ["light", "dark"] as const) {
  test(`has no axe violations with a result, ${theme} theme`, async ({ page }) => {
    recordPath(
      test.info(),
      `has no axe violations with a result, ${theme} theme, no conversion`,
      "message",
    );
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(MP4);
    await page.getByRole("button", { name: "Extract audio" }).click();
    await expect(page.getByRole("button", { name: "Download clip.m4a" })).toBeVisible({
      timeout: 60_000,
    });
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
  await expect(page.getByRole("region", { name: "Quick facts" })).toContainText("Up to 1 GB");
});
