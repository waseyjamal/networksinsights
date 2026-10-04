import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/video-audio/video-compressor/tool.config";
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

// Video compressor against `wrangler dev` (real CSP and headers). Mediabunny runs in the tool's
// worker with the browser's own WebCodecs decoder and encoders, on our own tiny clips
// (e2e/fixtures/README.md). Every result is downloaded and read back: container, codecs, picture
// size and length. What the browser can do is asked of the browser here, independently of the
// page: where it can decode and encode, the test compresses for real; where it cannot, the test
// checks the page's message, and records which path it took.

test.use({ baseURL: edgeURL });
test.setTimeout(180_000);

const PATH = "/video-compressor/";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const MP4 = { name: "clip.mp4", mimeType: "video/mp4", buffer: fixture("clip-h264-aac.mp4") };
const WEBM = { name: "clip.webm", mimeType: "video/webm", buffer: fixture("clip-vp9-opus.webm") };
const BIG = { name: "talk.mp4", mimeType: "video/mp4", buffer: fixture("target-h264-aac.mp4") };
const file = (page: Page) => page.locator("#video-compressor-file");
const MB = 1024 * 1024;

async function compress(page: Page, container: "mp4" | "webm", name: string) {
  await page.locator("#video-compressor-container").selectOption(container);
  await page.getByRole("button", { name: "Compress video" }).click();
  const button = page.getByRole("button", { name: `Download ${name}` });
  await expect(button).toBeVisible({ timeout: 120_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toBe(name);
  const bytes = readFileSync((await download.path()) ?? "");
  return { facts: readMedia(bytes), size: bytes.length };
}

for (const [source, codec] of [
  [MP4, "H.264"],
  [WEBM, "VP9"],
] as const) {
  test(`compresses a ${codec} clip to MP4 and WebM where the browser can, or says why`, async ({
    page,
  }, testInfo) => {
    const errors = collectErrors(page);
    const violations = await watchViolations(page);
    await openTool(page, PATH);
    const can = await browserCodecs(page);
    await expectProbeSane(page);
    const decodes = source === MP4 ? can.decodeAvc : can.decodeVp9;
    await file(page).setInputFiles(source);
    await expect(page.locator("#video-compressor-source")).toContainText("320 × 240 pixels");
    await page
      .locator("#video-compressor-quality")
      .or(page.locator("#video-compressor-support"))
      .first()
      .waitFor();

    for (const [container, encodes, video, audio] of [
      ["mp4", can.encodeAvc, "avc1", "mp4a"],
      ["webm", can.encodeVp9, "V_VP9", "A_OPUS"],
    ] as const) {
      const what = `${source.name} to ${container.toUpperCase()}`;
      if (decodes && encodes) {
        await page.locator("#video-compressor-quality").selectOption("low");
        const name = `clip-compressed.${container}`;
        const { facts } = await compress(page, container, name);
        expect(facts.codecs).toContain(video);
        expect(facts.width ?? 320).toBe(320);
        expect(facts.durationSeconds).toBeGreaterThan(1.8);
        expect(facts.durationSeconds).toBeLessThan(2.3);
        // MP4 copies AAC and Opus; WebM copies Opus and encodes AAC only with an Opus encoder.
        const keepsSound = container === "mp4" || source === WEBM || can.encodeOpus;
        if (keepsSound) {
          if (container === "webm") expect(facts.codecs).toContain(audio);
          else expect(facts.codecs.some((c) => c === "mp4a" || c === "Opus")).toBe(true);
        }
        recordPath(testInfo, what, "real");
      } else {
        await expect(page.locator(`[data-unavailable="${container}"]`)).toContainText(
          "is not offered",
        );
        recordPath(testInfo, what, "message");
      }
    }
    expect(errors).toEqual([]);
    expect(await violations()).toEqual([]);
  });
}

test("aims at a target size: about 0.5 MB from a 1 MB clip, and refuses less than 0.5 MB", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const can = await browserCodecs(page);
  await expectProbeSane(page);
  await file(page).setInputFiles(BIG);
  await expect(page.locator("#video-compressor-source")).toContainText("480 × 270 pixels");
  if (!(can.decodeAvc && (can.encodeAvc || can.encodeVp9))) {
    await expect(page.locator("#video-compressor-support")).toContainText(
      "Your browser cannot decode this video or cannot encode H.264 or VP9",
    );
    recordPath(testInfo, "target size", "message");
    return;
  }
  await page.locator("#video-compressor-mode").selectOption("size");
  const target = page.locator("#video-compressor-target");
  const button = page.getByRole("button", { name: "Compress video" });
  await target.fill("0.49");
  await expect(page.getByText("Enter a target size of at least 0.5 MB.")).toBeVisible();
  await expect(button).toBeDisabled();
  await target.fill("0.5");
  await expect(button).toBeEnabled();
  const container = can.encodeAvc ? "mp4" : "webm";
  const { facts, size } = await compress(page, container, `talk-compressed.${container}`);
  expect(BIG.buffer.length).toBeGreaterThan(MB);
  // Approximate by design: near half a megabyte, well under the 1 MB source.
  expect(size).toBeGreaterThan(0.2 * MB);
  expect(size).toBeLessThan(0.75 * MB);
  expect(facts.durationSeconds).toBeGreaterThan(7.8);
  await expect(page.locator("#video-compressor-result")).toContainText("aimed at about 0.5 MB");
  recordPath(testInfo, "target size", "real");
});

test("without WebCodecs encoders, says plainly that it cannot compress here", async ({ page }) => {
  recordPath(
    test.info(),
    "without WebCodecs encoders, says plainly that it cannot compress here, no conversion",
    "message",
  );
  await hideFromPage(page, ["VideoEncoder", "AudioEncoder"]);
  const errors = collectErrors(page);
  await openTool(page, PATH);
  expect(await page.evaluate(() => typeof VideoEncoder)).toBe("undefined");
  await file(page).setInputFiles(MP4);
  await expect(page.locator("#video-compressor-support")).toContainText(
    "this tool cannot compress it here",
  );
  await expect(page.locator('[data-unavailable="mp4"]')).toBeVisible();
  await expect(page.locator('[data-unavailable="webm"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Compress video" })).toBeDisabled();
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
    name: "photo.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("jpeg"),
  });
  await expect(page.getByRole("status")).toContainText(
    "photo.jpg: This file is not a video this tool reads.",
  );
  await file(page).setInputFiles({
    name: "broken.webm",
    mimeType: "video/webm",
    buffer: Buffer.from("not a video at all, just some bytes"),
  });
  await expect(page.getByRole("status")).toContainText("broken.webm: This file is not a video");
  await expect(page.getByRole("button", { name: "Compress video" })).toBeDisabled();
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
    await file(page).setInputFiles(MP4);
    await expect(page.locator("#video-compressor-source")).toBeVisible();
    await page
      .locator("#video-compressor-quality")
      .or(page.locator("#video-compressor-support"))
      .first()
      .waitFor();
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
  await expect(page.getByRole("region", { name: "Quick facts" })).toContainText("Up to 500 MB");
});
