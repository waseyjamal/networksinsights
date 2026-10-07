import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/video-audio/audio-joiner/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { browserCodecs, expectProbeSane, readMedia, recordPath, sineWav } from "./media";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Audio Joiner against `wrangler dev` (real CSP and headers). WAV needs no codec, so joining WAV
// files is a real run in every browser: a mono 22,050 Hz clip and a stereo 48,000 Hz clip of a
// 440 Hz tone are joined, and the downloaded WAV is read back in Node. Its header must give the
// highest rate, two channels and the summed length; its samples must still be a clean 440 Hz tone
// in each part (pitch kept), the mono part must be the same on both channels, and no step between
// two samples may be larger than a clean tone allows (no clicks, no garbled audio). An M4A is
// joined where the browser can decode AAC, and refused with the reason where it cannot.

test.use({ baseURL: edgeURL });
test.setTimeout(180_000);

const PATH = "/audio-joiner/";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const MEMO = { name: "memo.wav", mimeType: "audio/wav", buffer: sineWav(1, 22_050, 1) };
const CLIP = { name: "clip.wav", mimeType: "audio/wav", buffer: sineWav(1.5, 48_000, 2) };
const files = (page: Page) => page.locator("#audio-joiner-files");
const list = (page: Page) => page.getByRole("list", { name: "Recordings to join" }).locator("li");
const join = (page: Page) => page.getByRole("button", { name: /^Join \d+ recordings?$/ });

async function download(page: Page, name: string) {
  const button = page.getByRole("button", { name: `Download ${name}` });
  await expect(button).toBeVisible({ timeout: 120_000 });
  const [saved] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

/** The 16-bit samples of a WAV this tool writes (44-byte header), one array per channel. */
function channelsOf(wav: Buffer): Int16Array[] {
  const channels = wav.readUInt16LE(22);
  const frames = (wav.length - 44) / (2 * channels);
  return Array.from({ length: channels }, (_, channel) =>
    Int16Array.from({ length: frames }, (_, frame) =>
      wav.readInt16LE(44 + (frame * channels + channel) * 2),
    ),
  );
}

/** Rising zero crossings per second over frames [from, to). */
function frequency(samples: Int16Array, rate: number, from: number, to: number) {
  let rises = 0;
  for (let i = from + 1; i < to; i++) {
    if ((samples[i - 1] ?? 0) < 0 && (samples[i] ?? 0) >= 0) rises++;
  }
  return rises / ((to - from) / rate);
}

const peak = (samples: Int16Array, from: number, to: number) => {
  let most = 0;
  for (let i = from; i < to; i++) most = Math.max(most, Math.abs(samples[i] ?? 0));
  return most;
};

/**
 * The largest step between neighbouring samples in frames [from, to). A clean 440 Hz tone at
 * 12,000 moves at most 691 per sample at 48 kHz, and at most 1,504 at 22,050 Hz.
 */
const largestStep = (samples: Int16Array, from = 1, to = samples.length) => {
  let most = 0;
  for (let i = Math.max(1, from); i < to; i++) {
    most = Math.max(most, Math.abs((samples[i] ?? 0) - (samples[i - 1] ?? 0)));
  }
  return most;
};

/** The largest step between neighbouring samples of the source WAV itself (16-bit, first channel). */
const sourceStep = (wav: Buffer) => largestStep(channelsOf(wav)[0] ?? new Int16Array());

test("joins mono 22,050 Hz and stereo 48,000 Hz into a clean stereo WAV", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await files(page).setInputFiles([MEMO, CLIP]);
  await expect(list(page)).toHaveCount(2);
  await expect(list(page).nth(0)).toContainText("0:01, 22050 Hz, mono", { timeout: 60_000 });
  await expect(list(page).nth(1)).toContainText("0:02, 48000 Hz, stereo", { timeout: 60_000 });
  await expect(page.locator("#audio-joiner-summary")).toHaveText(
    "2 recordings, 0:03 in all. The joined WAV will be 48000 Hz stereo.",
  );
  await join(page).click();
  const wav = await download(page, "memo-joined.wav");
  const facts = readMedia(wav);
  expect(facts.sampleRate).toBe(48_000);
  expect(facts.channels).toBe(2);
  expect(facts.durationSeconds).toBeCloseTo(2.5, 4);

  const [left = new Int16Array(), right = new Int16Array()] = channelsOf(wav);
  expect(left.length).toBe(120_000);
  // The mono memo: frames 0 to 48,000, the same on both channels, still 440 Hz at the old level.
  expect(right.subarray(0, 48_000)).toEqual(left.subarray(0, 48_000));
  expect(Math.abs(frequency(left, 48_000, 0, 48_000) - 440)).toBeLessThanOrEqual(2);
  expect(peak(left, 0, 48_000)).toBeGreaterThan(11_900);
  expect(peak(left, 0, 48_000)).toBeLessThanOrEqual(12_000);
  // The stereo clip: frames 48,000 to 120,000, 440 Hz on both channels.
  expect(Math.abs(frequency(left, 48_000, 48_000, 120_000) - 440)).toBeLessThanOrEqual(2);
  expect(Math.abs(frequency(right, 48_000, 48_000, 120_000) - 440)).toBeLessThanOrEqual(2);
  // Inside each part the tone is smooth at 48 kHz. At the join the step can be no larger than
  // the memo's own steps at 22,050 Hz: its last sample is about -1,500 and the clip starts at 0.
  for (const channel of [left, right]) {
    expect(largestStep(channel, 1, 48_000)).toBeLessThan(720);
    expect(largestStep(channel, 48_001, 120_000)).toBeLessThan(720);
    expect(largestStep(channel, 48_000, 48_001)).toBeLessThanOrEqual(sourceStep(MEMO.buffer));
  }
  recordPath(testInfo, "WAV mono 22,050 Hz + WAV stereo 48,000 Hz joined", "real");
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("joins in the order of the list after moving a recording", async ({ page }, testInfo) => {
  await openTool(page, PATH);
  await files(page).setInputFiles([MEMO, CLIP]);
  await expect(list(page).nth(1)).toContainText("48000 Hz", { timeout: 60_000 });
  await page.getByRole("button", { name: "Move clip.wav up" }).click();
  await expect(list(page).nth(0)).toContainText("1. clip.wav");
  await join(page).click();
  const wav = await download(page, "clip-joined.wav");
  const [left = new Int16Array(), right = new Int16Array()] = channelsOf(wav);
  expect(left.length).toBe(120_000);
  // Now the mono memo is last: frames 72,000 to 120,000.
  expect(right.subarray(72_000)).toEqual(left.subarray(72_000));
  expect(Math.abs(frequency(left, 48_000, 72_000, 120_000) - 440)).toBeLessThanOrEqual(2);
  expect(largestStep(left, 1, 72_000)).toBeLessThan(720);
  expect(largestStep(left, 72_001, 120_000)).toBeLessThan(720);
  expect(largestStep(left, 72_000, 72_001)).toBeLessThanOrEqual(sourceStep(MEMO.buffer));
  recordPath(testInfo, "WAV clips joined in a changed order", "real");
});

test("refuses a recording with more than two channels", async ({ page }) => {
  await openTool(page, PATH);
  await files(page).setInputFiles([
    { name: "surround.wav", mimeType: "audio/wav", buffer: sineWav(0.2, 48_000, 6) },
  ]);
  await expect(list(page).nth(0)).toContainText(
    "This recording has 6 channels. Only mono and stereo recordings can be joined.",
    { timeout: 60_000 },
  );
});

test("joins an M4A where the browser decodes AAC, and says so where it cannot", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const can = await browserCodecs(page);
  await expectProbeSane(page);
  await files(page).setInputFiles([
    { name: "tone.m4a", mimeType: "audio/mp4", buffer: fixture("tone-aac.m4a") },
    MEMO,
  ]);
  if (can.decodeAac) {
    await expect(list(page).nth(0)).toContainText("48000 Hz, stereo", { timeout: 60_000 });
    await join(page).click();
    const wav = await download(page, "tone-joined.wav");
    const facts = readMedia(wav);
    expect(facts.sampleRate).toBe(48_000);
    expect(facts.channels).toBe(2);
    expect(facts.durationSeconds).toBeGreaterThan(1.95);
    expect(facts.durationSeconds).toBeLessThan(2.1);
    const [left = new Int16Array()] = channelsOf(wav);
    expect(Math.abs(frequency(left, 48_000, 2_400, 45_600) - 440)).toBeLessThanOrEqual(3);
    recordPath(testInfo, "M4A (AAC) + WAV joined", "real");
  } else {
    await expect(list(page).nth(0)).toContainText(
      /This browser cannot decode \w+ sound, so this file cannot be joined here\. WAV files work in every browser\./,
      { timeout: 60_000 },
    );
    await join(page).click();
    await expect(page.getByRole("alert")).toHaveText(
      "Remove the recordings that could not be read, then join again.",
    );
    recordPath(testInfo, "M4A in a browser without an AAC decoder", "message");
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await files(page).setInputFiles([MEMO, CLIP]);
    await expect(page.locator("#audio-joiner-summary")).toBeVisible({ timeout: 60_000 });
    await join(page).click();
    await expect(page.getByRole("button", { name: "Download memo-joined.wav" })).toBeVisible({
      timeout: 120_000,
    });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
