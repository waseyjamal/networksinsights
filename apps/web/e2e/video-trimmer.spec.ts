import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/video-audio/video-trimmer/tool.config";
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

// Video Trimmer against `wrangler dev` (real CSP and headers). Mediabunny runs in the tool's worker
// on our own tiny clips (e2e/fixtures/README.md); each has a key frame only at its start, so a fast
// cut visibly snaps back to 0:00. Every result is downloaded and read back: container, codecs and
// length. The fast cut copies and needs no codec, so it runs for real in every browser. The exact
// cut runs where the browser itself says it can decode and encode, and elsewhere the test checks
// the page's message; each test records which path it took.

test.use({ baseURL: edgeURL });
test.setTimeout(180_000);

const PATH = "/video-trimmer/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const TALK = { name: "talk.mp4", mimeType: "video/mp4", buffer: fixture("target-h264-aac.mp4") };
const WEBM = { name: "clip.webm", mimeType: "video/webm", buffer: fixture("clip-vp9-opus.webm") };
const file = (page: Page) => page.locator("#video-trimmer-file");
const field = (page: Page, key: string) => page.locator(`#video-trimmer-${key}`);
const result = (page: Page) => page.getByRole("list", { name: "Trimmed video" }).locator("li");

async function opened(page: Page, text: string, timeout = 60_000) {
  await expect(field(page, "source")).toContainText(text, { timeout });
}

async function trim(page: Page, start: string, end: string, name: string) {
  await field(page, "start").fill(start);
  await field(page, "end").fill(end);
  await page.getByRole("button", { name: "Trim video" }).click();
  const button = page.getByRole("button", { name: `Download ${name}` });
  await expect(button).toBeVisible({ timeout: 120_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toBe(name);
  return readMedia(readFileSync((await download.path()) ?? ""));
}

test("a fast cut from 2.5 to 5 snaps back to the key frame at 0:00, as the page example says", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(TALK);
  await opened(page, "talk.mp4: 0:08 long, 480 × 270 pixels");
  await field(page, "mode").selectOption("fast");
  const facts = await trim(page, "2.5", "5", "talk-trimmed.mp4");
  expect(facts.container).toBe("mp4");
  expect(facts.codecs).toContain("avc1");
  expect(facts.codecs).toContain("mp4a");
  expect(facts.durationSeconds).toBeGreaterThan(4.9);
  expect(facts.durationSeconds).toBeLessThan(5.2);
  await expect(result(page)).toContainText("5 seconds long, from 0:00 of the original");
  await expect(field(page, "keyframe")).toHaveText(
    "The fast cut starts at the key frame at 0:00, before the 0:02.5 you chose. Use the exact cut to start on that frame.",
  );
  recordPath(testInfo, "fast cut of an MP4", "real");
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("an exact cut from 2.5 to 5 is 2.5 seconds, where the browser can encode", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const can = await browserCodecs(page);
  await expectProbeSane(page);
  await file(page).setInputFiles(TALK);
  await opened(page, "talk.mp4");
  if (!(can.decodeAvc && can.encodeAvc)) {
    await expect(field(page, "support")).toContainText(
      "Your browser cannot decode and encode this video, so only the fast keyframe cut is offered here.",
    );
    await expect(field(page, "mode").locator("option")).toHaveCount(1);
    recordPath(testInfo, "exact cut of an MP4", "message");
    return;
  }
  await field(page, "mode").selectOption("exact");
  const facts = await trim(page, "2.5", "5", "talk-trimmed.mp4");
  expect(facts.codecs).toContain("avc1");
  expect(facts.durationSeconds).toBeGreaterThan(2.4);
  expect(facts.durationSeconds).toBeLessThan(2.6);
  await expect(result(page)).toContainText("2.5 seconds long, from 0:02.5 of the original");
  await expect(field(page, "keyframe")).toHaveCount(0);
  recordPath(testInfo, "exact cut of an MP4", "real");
});

test("keeps WebM as WebM, fast everywhere and exact where the browser can", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const can = await browserCodecs(page);
  await file(page).setInputFiles(WEBM);
  await opened(page, "clip.webm: 0:02.008 long, 320 × 240 pixels");
  let facts = await trim(page, "0.5", "1.5", "clip-trimmed.webm");
  expect(facts.container).toBe("webm");
  expect(facts.codecs).toContain("V_VP9");
  expect(facts.durationSeconds).toBeGreaterThan(1.4);
  expect(facts.durationSeconds).toBeLessThan(1.6);
  recordPath(testInfo, "fast cut of a WebM", "real");
  if (can.decodeVp9 && (await field(page, "mode").locator('option[value="exact"]').count()) > 0) {
    await field(page, "mode").selectOption("exact");
    facts = await trim(page, "0.5", "1.5", "clip-trimmed.webm");
    expect(facts.container).toBe("webm");
    expect(facts.durationSeconds).toBeGreaterThan(0.9);
    expect(facts.durationSeconds).toBeLessThan(1.1);
    recordPath(testInfo, "exact cut of a WebM", "real");
  } else {
    await expect(field(page, "support")).toBeVisible();
    recordPath(testInfo, "exact cut of a WebM", "message");
  }
});

test("without VideoEncoder only the fast cut is offered, and it still works", async ({
  page,
}, testInfo) => {
  await hideFromPage(page, ["VideoEncoder"]);
  await openTool(page, PATH);
  await file(page).setInputFiles(TALK);
  await opened(page, "talk.mp4");
  await expect(field(page, "support")).toContainText(
    "Your browser cannot decode and encode this video, so only the fast keyframe cut is offered here. A recent Chrome or Edge on a computer can do both.",
  );
  await expect(field(page, "mode").locator("option")).toHaveText([
    "Fast: keyframe cut, no re-encoding",
  ]);
  recordPath(testInfo, "exact cut with VideoEncoder hidden", "message");
  const facts = await trim(page, "1", "3", "talk-trimmed.mp4");
  expect(facts.durationSeconds).toBeGreaterThan(2.9);
  expect(facts.durationSeconds).toBeLessThan(3.2);
  recordPath(testInfo, "fast cut with VideoEncoder hidden", "real");
});

test("refuses times out of order, past the end, under 0.1 seconds or unreadable", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(TALK);
  await opened(page, "talk.mp4");
  await expect(field(page, "end")).toHaveValue("0:08");
  const go = page.getByRole("button", { name: "Trim video" });
  for (const [start, end, message] of [
    ["5", "2", "The end must come after the start."],
    ["0", "8.001", "The video is only 0:08 long."],
    ["1", "1.099", "The cut must be at least 0.1 seconds long."],
    [
      "one",
      "2",
      "Write the start as seconds, such as 12.5, or as minutes and seconds, such as 1:05.",
    ],
  ] as const) {
    await field(page, "start").fill(start);
    await field(page, "end").fill(end);
    await go.click();
    await expect(page.getByRole("alert")).toHaveText(message);
  }
  const facts = await trim(page, "7.9", "8", "talk-trimmed.mp4");
  expect(facts.durationSeconds).toBeGreaterThan(0);
  await expect(result(page)).toBeVisible();
  recordPath(testInfo, "a 0.1 second cut at the very end", "real");
});

test("takes the start and end from the player", async ({ page }, testInfo) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(TALK);
  await opened(page, "talk.mp4");
  const seek = (seconds: number) =>
    page.locator("video").evaluate(async (video: HTMLVideoElement, to) => {
      if (video.readyState < 1) {
        await new Promise((resolve) =>
          video.addEventListener("loadedmetadata", resolve, { once: true }),
        );
      }
      await new Promise((resolve) => {
        video.addEventListener("seeked", resolve, { once: true });
        video.currentTime = to;
      });
    }, seconds);
  await seek(3);
  await page.getByRole("button", { name: "Use the player's time as start" }).click();
  await expect(field(page, "start")).toHaveValue("0:03");
  await seek(6.5);
  await page.getByRole("button", { name: "Use the player's time as end" }).click();
  await expect(field(page, "end")).toHaveValue("0:06.5");
  recordPath(testInfo, "player times", "message");
});

test("refuses a file one byte over 500 MB, and opens one of exactly 500 MB", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const write = (name: string, size: number) => {
    const path = testInfo.outputPath(name);
    writeFileSync(path, TALK.buffer);
    // Zeros after the last box, written as one byte at the very end: a sparse, fast file.
    const fd = openSync(path, "r+");
    writeSync(fd, Buffer.alloc(1), 0, 1, size - 1);
    closeSync(fd);
    return path;
  };
  await file(page).setInputFiles(write("over.mp4", LIMIT + 1));
  await expect(page.getByText("over.mp4: This file is larger than 500 MB.")).toBeVisible();
  await file(page).setInputFiles(write("big.mp4", LIMIT));
  await opened(page, "big.mp4: 0:08 long", 150_000);
  await expect(field(page, "source")).toContainText("500 MB");
  recordPath(testInfo, "500 MB limit", "message");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({
    page,
  }, testInfo) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(TALK);
    await opened(page, "talk.mp4");
    await trim(page, "1", "2", "talk-trimmed.mp4");
    await expectNoAxeViolations(page);
    recordPath(testInfo, `axe, ${theme}`, "real");
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
