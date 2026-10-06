import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/video-audio/audio-cutter/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import {
  browserCodecs,
  expectProbeSane,
  hideFromPage,
  type MediaFacts,
  readMedia,
  recordPath,
  sineWav,
} from "./media";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Audio Cutter against `wrangler dev` (real CSP and headers). WAV needs no decoder, so the exact WAV
// cut runs for real in every browser; an M4A is cut by copying, which needs no codec, in every
// browser too. Opus and AAC decoding follow what the browser itself says it can do. Every file is
// downloaded and its header read back in Node.

test.use({ baseURL: edgeURL });
test.setTimeout(180_000);

const PATH = "/audio-cutter/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const WAV = { name: "tone.wav", mimeType: "audio/wav", buffer: sineWav(3) };
const M4A = { name: "voice.m4a", mimeType: "audio/mp4", buffer: fixture("tone-aac.m4a") };
const OGG = { name: "song.ogg", mimeType: "audio/ogg", buffer: fixture("tone-opus.ogg") };
const file = (page: Page) => page.locator("#audio-cutter-file");
const source = (page: Page) => page.locator("#audio-cutter-source");
const support = (page: Page) => page.locator("#audio-cutter-support");
const mode = (page: Page) => page.locator("#audio-cutter-mode");

async function cutAndRead(
  page: Page,
  start: string,
  end: string,
  how: "copy" | "wav",
  name: string,
): Promise<MediaFacts> {
  await page.locator("#audio-cutter-start").fill(start);
  await page.locator("#audio-cutter-end").fill(end);
  await mode(page).selectOption(how);
  await page.getByRole("button", { name: "Cut", exact: true }).click();
  const button = page.getByRole("button", { name: `Download ${name}` });
  await expect(button).toBeVisible({ timeout: 120_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toBe(name);
  return readMedia(readFileSync((await download.path()) ?? ""));
}

const options = (page: Page) =>
  mode(page)
    .locator("option")
    .evaluateAll((list) => list.map((option) => (option as HTMLOptionElement).value));

test("cuts a WAV exactly, to the sample, in every browser", async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(WAV);
  await expect(source(page)).toHaveText("tone.wav: 0:03 long, 48000 Hz, 2 channels, 563 KB");
  await expect(support(page)).toHaveText(
    "This recording cannot be cut without re-encoding: only M4A files can. The exact WAV cut is offered instead.",
  );
  expect(await options(page)).toEqual(["wav"]);
  await expect(page.locator("#audio-cutter-end")).toHaveValue("0:03");
  const wav = await cutAndRead(page, "0.5", "1.75", "wav", "tone-cut.wav");
  expect(wav.container).toBe("wav");
  expect(wav.sampleRate).toBe(48_000);
  expect(wav.channels).toBe(2);
  expect(wav.durationSeconds).toBe(1.25);
  await expect(page.getByRole("list", { name: "Cut recording" })).toContainText("0:01.25 long");
  recordPath(testInfo, "WAV exact cut, 0.5 to 1.75 s", "real");
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("cuts an M4A without re-encoding in every browser, and as WAV where AAC decodes", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  await openTool(page, PATH);
  const can = await browserCodecs(page);
  await expectProbeSane(page);
  await file(page).setInputFiles(M4A);
  await expect(source(page)).toContainText("voice.m4a: 0:01 long");
  const copied = await cutAndRead(page, "0.25", "0.75", "copy", "voice-cut.m4a");
  expect(copied.container).toBe("mp4");
  expect(copied.codecs).toEqual(["mp4a"]);
  expect(copied.durationSeconds).toBeGreaterThan(0.45);
  expect(copied.durationSeconds).toBeLessThan(0.6);
  await expect(page.getByRole("list", { name: "Cut recording" })).toContainText("not re-encoded");
  recordPath(testInfo, "M4A copied cut", "real");

  if (can.decodeAac) {
    expect(await options(page)).toEqual(["copy", "wav"]);
    const wav = await cutAndRead(page, "0.25", "0.75", "wav", "voice-cut.wav");
    expect(wav.durationSeconds).toBeCloseTo(0.5, 2);
    recordPath(testInfo, "M4A exact WAV cut", "real");
  } else {
    expect(await options(page)).toEqual(["copy"]);
    await expect(support(page)).toContainText("Your browser cannot decode this recording");
    recordPath(testInfo, "M4A exact WAV cut", "message");
  }
  expect(errors).toEqual([]);
});

test("cuts an OGG as WAV where Opus decodes, and says plainly where it cannot", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const can = await browserCodecs(page);
  await file(page).setInputFiles(OGG);
  await expect(source(page)).toContainText("song.ogg: 0:01 long");
  if (can.decodeOpus) {
    expect(await options(page)).toEqual(["wav"]);
    const wav = await cutAndRead(page, "0", "0.5", "wav", "song-cut.wav");
    expect(wav.sampleRate).toBe(48_000);
    expect(wav.durationSeconds).toBeCloseTo(0.5, 2);
    recordPath(testInfo, "OGG Opus exact WAV cut", "real");
  } else {
    await expect(support(page)).toContainText("Your browser cannot cut this recording");
    await expect(page.getByRole("button", { name: "Cut", exact: true })).toHaveCount(0);
    recordPath(testInfo, "OGG Opus exact WAV cut", "message");
  }
});

test("with no WebCodecs decoder, copies M4A, cuts WAV, and says it cannot cut OGG", async ({
  page,
}, testInfo) => {
  await hideFromPage(page, ["AudioDecoder", "AudioEncoder"]);
  const errors = collectErrors(page);
  await openTool(page, PATH);
  expect(await page.evaluate(() => typeof AudioDecoder)).toBe("undefined");
  await file(page).setInputFiles(M4A);
  await expect(support(page)).toHaveText(
    "Your browser cannot decode this recording, so the exact WAV cut is not offered. A recent Chrome or Edge on a computer decodes the most formats.",
  );
  expect(await options(page)).toEqual(["copy"]);
  await file(page).setInputFiles(OGG);
  await expect(support(page)).toHaveText(
    "Your browser cannot cut this recording: it cannot decode it, and its format cannot be cut without re-encoding. A recent Chrome or Edge on a computer decodes the most formats.",
  );
  await expect(page.getByRole("button", { name: "Cut", exact: true })).toHaveCount(0);
  await file(page).setInputFiles(WAV);
  const wav = await cutAndRead(page, "1", "2", "wav", "tone-cut.wav");
  expect(wav.durationSeconds).toBe(1);
  recordPath(testInfo, "WAV exact cut with no WebCodecs", "real");
  recordPath(testInfo, "M4A and OGG with no decoder", "message");
  expect(errors).toEqual([]);
});

test("checks the times, and refuses files it cannot read", async ({ page }, testInfo) => {
  recordPath(testInfo, "time and file checks, no conversion", "message");
  await openTool(page, PATH);
  await file(page).setInputFiles(WAV);
  await expect(source(page)).toContainText("tone.wav");
  const cutWith = async (start: string, end: string) => {
    await page.locator("#audio-cutter-start").fill(start);
    await page.locator("#audio-cutter-end").fill(end);
    await page.getByRole("button", { name: "Cut", exact: true }).click();
  };
  await cutWith("2", "1");
  await expect(page.getByRole("alert")).toHaveText("The end must come after the start.");
  await cutWith("0", "3.001");
  await expect(page.getByRole("alert")).toHaveText("The recording is only 0:03 long.");
  await cutWith("1", "1.099");
  await expect(page.getByRole("alert")).toHaveText("The cut must be at least 0.1 seconds long.");
  await cutWith("a", "1");
  await expect(page.getByRole("alert")).toHaveText(
    "Write the start as seconds, such as 12.5, or as minutes and seconds, such as 1:05.",
  );

  await file(page).setInputFiles({
    name: "song.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from("ID3"),
  });
  await expect(page.getByRole("status")).toHaveText(
    "song.mp3: This file is not a recording this tool reads. Choose a WAV, M4A, OGG or WebM file.",
  );
  await file(page).setInputFiles({
    name: "broken.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFF0000WAVEjunk"),
  });
  await expect(page.getByRole("status")).toContainText("broken.wav: This file");
});

test("an exact WAV cut of 10 minutes works and one millisecond more is refused", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  // 10 minutes and 1 second of 8 kHz mono: about 9.6 MB.
  await file(page).setInputFiles({
    name: "talk.wav",
    mimeType: "audio/wav",
    buffer: sineWav(601, 8000, 1),
  });
  await expect(source(page)).toContainText("talk.wav: 10:01 long, 8000 Hz, mono");
  await page.locator("#audio-cutter-start").fill("0");
  await page.locator("#audio-cutter-end").fill("10:00.001");
  await page.getByRole("button", { name: "Cut", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "An exact WAV cut can be at most 10 minutes long. Choose a shorter part, or keep the format.",
  );
  const wav = await cutAndRead(page, "0", "10:00", "wav", "talk-cut.wav");
  expect(wav.durationSeconds).toBe(600);
  recordPath(testInfo, "WAV exact cut of exactly 10 minutes", "real");
});

test("refuses a file one byte over 300 MB, and cuts one of exactly 300 MB", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  // A 16-bit stereo WAV header over silence, so the whole file has the exact size.
  const silentWav = (size: number) => {
    const bytes = Buffer.alloc(size);
    const header = sineWav(0);
    header.copy(bytes, 0, 0, 44);
    bytes.writeUInt32LE(size - 8, 4);
    bytes.writeUInt32LE(size - 44, 40);
    return bytes;
  };
  const over = testInfo.outputPath("over.wav");
  writeFileSync(over, silentWav(LIMIT + 1));
  await file(page).setInputFiles(over);
  await expect(page.getByRole("status")).toHaveText("over.wav: This file is larger than 300 MB.");

  const atLimit = testInfo.outputPath("big.wav");
  writeFileSync(atLimit, silentWav(LIMIT));
  await file(page).setInputFiles(atLimit);
  await expect(source(page)).toContainText("big.wav: 27:18", { timeout: 60_000 });
  await expect(source(page)).toContainText("300 MB");
  const wav = await cutAndRead(page, "27:00", "27:01", "wav", "big-cut.wav");
  expect(wav.durationSeconds).toBe(1);
  recordPath(testInfo, "300 MB WAV, 1 second cut", "real");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a cut shown, ${theme} theme`, async ({ page }, testInfo) => {
    recordPath(testInfo, "accessibility of the result", "real");
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(WAV);
    await expect(source(page)).toContainText("tone.wav");
    await page.getByRole("button", { name: "Cut", exact: true }).click();
    await expect(page.getByRole("button", { name: "Download tone-cut.wav" })).toBeVisible({
      timeout: 60_000,
    });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({
  page,
}, testInfo) => {
  recordPath(testInfo, "page facts, no conversion", "message");
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});
