import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { readMp3 } from "../../../tools/video-audio/audio-to-mp3/logic";
import manifest from "../../../tools/video-audio/audio-to-mp3/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { browserCodecs, expectProbeSane, hideFromPage, recordPath, sineWav } from "./media";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Audio to MP3 against `wrangler dev` (real CSP and headers). WAV needs no browser decoder, so WAV
// to MP3 runs for real in every browser: Mediabunny reads the samples and LAME, fetched as its own
// unmodified file from /vendor/wasm-media-encoders/ (ADR 0064), encodes them. AAC and Opus follow
// what the browser itself says it can decode. Every MP3 is downloaded and its frames read back.

test.use({ baseURL: edgeURL });
test.setTimeout(120_000);

const PATH = "/audio-to-mp3/";
const WASM = "/vendor/wasm-media-encoders/0.7.0/mp3.wasm";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const WAV = { name: "tone.wav", mimeType: "audio/wav", buffer: sineWav(2) };
const MONO = { name: "voice.wav", mimeType: "audio/wav", buffer: sineWav(1, 22_050, 1) };
const M4A = { name: "voice.m4a", mimeType: "audio/mp4", buffer: fixture("tone-aac.m4a") };
const OGG = { name: "song.ogg", mimeType: "audio/ogg", buffer: fixture("tone-opus.ogg") };
const file = (page: Page) => page.locator("#audio-to-mp3-file");

async function encode(page: Page, bitrate: string, name: string) {
  await page.locator("#audio-to-mp3-bitrate").selectOption(bitrate);
  await page.getByRole("button", { name: "Make MP3" }).click();
  const button = page.getByRole("button", { name: `Download ${name}` });
  await expect(button).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toBe(name);
  return readMp3(new Uint8Array(readFileSync((await download.path()) ?? "")));
}

test("makes a real MP3 from WAV in every browser, with LAME from its vendored file", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(WAV);
  await expect(page.locator("#audio-to-mp3-source")).toContainText("tone.wav");
  await expect(page.locator("#audio-to-mp3-source")).toContainText("0:02");

  const wasm = page.waitForResponse((response) => response.url().endsWith(WASM));
  const mp3 = await encode(page, "192", "tone.mp3");
  const response = await wasm;
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/wasm");
  expect(mp3?.sampleRate).toBe(48_000);
  expect(mp3?.channels).toBe(2);
  expect(mp3?.bitrates).toEqual([192]);
  expect(mp3?.durationSeconds).toBeGreaterThan(1.99);
  expect(mp3?.durationSeconds).toBeLessThan(2.1);
  recordPath(testInfo, "WAV (48 kHz stereo) to MP3 at 192 kbit/s", "real");

  // A mono 22.05 kHz recording stays mono and is resampled to 44.1 kHz, at 320 kbit/s.
  await file(page).setInputFiles(MONO);
  await expect(page.locator("#audio-to-mp3-source")).toContainText("voice.wav");
  const mono = await encode(page, "320", "voice.mp3");
  expect(mono?.sampleRate).toBe(44_100);
  expect(mono?.channels).toBe(1);
  expect(mono?.bitrates).toEqual([320]);
  expect(mono?.durationSeconds).toBeGreaterThan(0.99);
  expect(mono?.durationSeconds).toBeLessThan(1.1);
  recordPath(testInfo, "WAV (22.05 kHz mono) to MP3 at 320 kbit/s", "real");
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("makes MP3 from AAC and Opus where the browser decodes them, and says so where not", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  await openTool(page, PATH);
  const can = await browserCodecs(page);
  await expectProbeSane(page);
  for (const [source, decodes] of [
    [M4A, can.decodeAac],
    [OGG, can.decodeOpus],
  ] as const) {
    await file(page).setInputFiles(source);
    await expect(page.locator("#audio-to-mp3-source")).toContainText(source.name);
    if (decodes) {
      const mp3 = await encode(page, "128", source.name.replace(/\.\w+$/, ".mp3"));
      expect(mp3?.bitrates).toEqual([128]);
      expect(mp3?.durationSeconds).toBeGreaterThan(0.95);
      expect(mp3?.durationSeconds).toBeLessThan(1.15);
      recordPath(testInfo, `${source.name} to MP3`, "real");
    } else {
      await expect(page.locator("#audio-to-mp3-support")).toContainText(
        "Your browser cannot decode this recording",
      );
      recordPath(testInfo, `${source.name} to MP3`, "message");
    }
  }
  expect(errors).toEqual([]);
});

test("with no WebCodecs decoder, still converts WAV and says it cannot convert AAC", async ({
  page,
}, testInfo) => {
  await hideFromPage(page, ["AudioEncoder", "AudioDecoder"]);
  const errors = collectErrors(page);
  await openTool(page, PATH);
  expect(await page.evaluate(() => typeof AudioDecoder)).toBe("undefined");
  await file(page).setInputFiles(M4A);
  await expect(page.locator("#audio-to-mp3-support")).toContainText(
    "Your browser cannot decode this recording, so it cannot make an MP3 of it here.",
  );
  await expect(page.getByRole("button", { name: "Make MP3" })).toBeDisabled();
  await file(page).setInputFiles(WAV);
  const mp3 = await encode(page, "128", "tone.mp3");
  expect(mp3?.bitrates).toEqual([128]);
  recordPath(testInfo, "WAV to MP3 with no WebCodecs", "real");
  expect(errors).toEqual([]);
});

test("refuses an MP3, a file that is not a recording, and one that cannot be read", async ({
  page,
}) => {
  recordPath(test.info(), "refuses files, no conversion", "message");
  await openTool(page, PATH);
  await file(page).setInputFiles({
    name: "song.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from("ID3"),
  });
  await expect(page.getByRole("status")).toContainText(
    "song.mp3: This file is an MP3 already. Choose a recording in another format.",
  );
  await file(page).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("text"),
  });
  await expect(page.getByRole("status")).toContainText(
    "notes.txt: This file is not a recording this tool reads.",
  );
  await file(page).setInputFiles({
    name: "broken.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("not a recording at all, just some bytes"),
  });
  await expect(page.getByRole("status")).toContainText("broken.wav: This file is not a recording");
  await expect(page.getByRole("button", { name: "Make MP3" })).toBeDisabled();
});

for (const theme of ["light", "dark"] as const) {
  test(`has no axe violations with a result, ${theme} theme`, async ({ page }) => {
    recordPath(test.info(), `axe with a result, ${theme} theme`, "real");
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(WAV);
    await page.getByRole("button", { name: "Make MP3" }).click();
    await expect(page.getByRole("button", { name: "Download tone.mp3" })).toBeVisible({
      timeout: 60_000,
    });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts come from the manifest", async ({ page }) => {
  recordPath(test.info(), "structured data and Quick facts, no conversion", "message");
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
  await expect(page.getByRole("region", { name: "Quick facts" })).toContainText("Up to 300 MB");
});
