import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/video-audio/audio-silence-remover/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { browserCodecs, hideFromPage, readMedia, recordPath, sineWav } from "./media";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Audio Silence Remover against `wrangler dev` (real CSP and headers). The recordings are written
// here as WAV, which needs no decoder, so the real run happens in every browser: tone and silence
// in known places, so the length after cleaning is known to the sample. The WAV that comes back is
// read in Node, its length and its loudest sample checked. M4A and OGG follow what the browser
// itself says it can encode.

test.use({ baseURL: edgeURL });
test.setTimeout(180_000);

const PATH = "/audio-silence-remover/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const file = (page: Page) => page.locator("#audio-silence-remover-file");
const source = (page: Page) => page.locator("#audio-silence-remover-source");
const run = (page: Page) => page.getByRole("button", { name: "Remove silence" });
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

/** A 48 kHz stereo WAV of tone (a quarter of full scale) and silence, in the given seconds. */
function speechWav(parts: Array<[number, boolean]>, rate = 48_000, channels = 2): Buffer {
  const frames = parts.reduce((sum, [seconds]) => sum + Math.round(seconds * rate), 0);
  const wav = sineWav(0, rate, channels);
  const data = Buffer.alloc(frames * channels * 2);
  let at = 0;
  for (const [seconds, on] of parts) {
    for (let i = 0; i < Math.round(seconds * rate); i++, at++) {
      const value = on ? Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8192) : 0;
      for (let c = 0; c < channels; c++) data.writeInt16LE(value, (at * channels + c) * 2);
    }
  }
  const header = Buffer.from(wav.subarray(0, 44));
  header.writeUInt32LE(36 + data.length, 4);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const SPEECH = {
  name: "memo.wav",
  mimeType: "audio/wav",
  buffer: speechWav([
    [1, false],
    [1, true],
    [2, false],
    [1, true],
    [1, false],
  ]),
};

async function download(page: Page, name: string) {
  const button = page.getByRole("button", { name: `Download ${name}` });
  await expect(button).toBeVisible({ timeout: 120_000 });
  const [saved] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

/** The loudest 16-bit sample of a WAV, as a fraction of full scale. */
function peak(wav: Buffer): number {
  let max = 0;
  for (let at = 44; at + 1 < wav.length; at += 2)
    max = Math.max(max, Math.abs(wav.readInt16LE(at)));
  return max / 32768;
}

const outputs = (page: Page) =>
  page
    .locator("#audio-silence-remover-output option")
    .evaluateAll((list) => list.map((option) => (option as HTMLOptionElement).value));

test("cuts the silence at both ends, shortens the long pause, and normalises to -1 dB", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(page.getByText("It removes silence, not noise")).toBeVisible();
  await file(page).setInputFiles(SPEECH);
  await expect(source(page)).toHaveText("memo.wav: 6 s, 48000 Hz, 2 channels, 1.1 MB");
  await run(page).click();
  const wav = await download(page, "memo-trimmed.wav");
  const facts = readMedia(wav);
  expect(facts).toMatchObject({ container: "wav", sampleRate: 48_000, channels: 2 });
  expect(facts.durationSeconds).toBe(2.25);
  expect(peak(wav)).toBeCloseTo(10 ** (-1 / 20), 2);
  await expect(page.getByRole("list", { name: "Trimmed recording" })).toContainText(
    "6 s to 2.25 s, volume +11 dB",
  );
  recordPath(testInfo, "WAV with silence and pauses removed, normalised", "real");
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("keeps the volume when Normalise is off, and writes M4A and OGG where the browser can", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const can = await browserCodecs(page);
  await file(page).setInputFiles(SPEECH);
  await expect(source(page)).toContainText("memo.wav");
  await page.getByLabel("Normalise: bring the loudest peak to -1 dB").uncheck();
  await run(page).click();
  const plain = await download(page, "memo-trimmed.wav");
  expect(peak(plain)).toBeCloseTo(0.25, 2);
  const offered = await outputs(page);
  expect(offered).toEqual(
    ["wav", can.encodeAac ? "m4a" : "", can.encodeOpus ? "ogg" : ""].filter(Boolean),
  );
  for (const [id, container] of [
    ["m4a", "mp4"],
    ["ogg", "ogg"],
  ] as const) {
    if (!offered.includes(id)) {
      recordPath(testInfo, `${id} output`, "message");
      continue;
    }
    await page.locator("#audio-silence-remover-output").selectOption(id);
    await run(page).click();
    const facts = readMedia(await download(page, `memo-trimmed.${id}`));
    expect(facts.container).toBe(container);
    expect(facts.durationSeconds).toBeGreaterThan(2.2);
    expect(facts.durationSeconds).toBeLessThan(2.35);
    recordPath(testInfo, `${id} output`, "real");
  }
});

test("with no WebCodecs, still cleans WAV and says it cannot decode M4A", async ({
  page,
}, testInfo) => {
  await hideFromPage(page, ["AudioEncoder", "AudioDecoder"]);
  const errors = collectErrors(page);
  await openTool(page, PATH);
  await file(page).setInputFiles({
    name: "voice.m4a",
    mimeType: "audio/mp4",
    buffer: fixture("tone-aac.m4a"),
  });
  await expect(page.locator("#audio-silence-remover-support")).toHaveText(
    "Your browser cannot decode this recording, so it cannot be cleaned here. A recent Chrome or Edge on a computer decodes the most formats.",
  );
  await expect(run(page)).toHaveCount(0);
  await file(page).setInputFiles(SPEECH);
  await expect(source(page)).toContainText("memo.wav");
  expect(await outputs(page)).toEqual(["wav"]);
  await run(page).click();
  expect(readMedia(await download(page, "memo-trimmed.wav")).durationSeconds).toBe(2.25);
  recordPath(testInfo, "WAV with no WebCodecs", "real");
  recordPath(testInfo, "M4A with no decoder", "message");
  expect(errors).toEqual([]);
});

test("checks the settings at their edges, and says when everything is silent", async ({
  page,
}, testInfo) => {
  recordPath(testInfo, "settings and silence checks", "real");
  await openTool(page, PATH);
  await file(page).setInputFiles({
    name: "quiet.wav",
    mimeType: "audio/wav",
    buffer: speechWav([[2, false]]),
  });
  await expect(source(page)).toContainText("quiet.wav");
  const threshold = page.locator("#audio-silence-remover-threshold");
  const shortest = page.locator("#audio-silence-remover-min");
  await threshold.fill("-71");
  await expect(page.getByText("Threshold must be from -70 to -20 dB.")).toBeVisible();
  await threshold.fill("-19");
  await expect(page.getByText("Threshold must be from -70 to -20 dB.")).toBeVisible();
  await shortest.fill("0.29");
  await expect(page.getByText("Shortest silence must be from 0.3 to 10 seconds.")).toBeVisible();
  await run(page).click();
  await expect(page.getByRole("alert")).toHaveText("Threshold must be from -70 to -20 dB.");
  await shortest.fill("10.1");
  await expect(page.getByText("Shortest silence must be from 0.3 to 10 seconds.")).toBeVisible();
  await threshold.fill("-70");
  await shortest.fill("10");
  await run(page).click();
  await expect(page.getByRole("alert")).toHaveText(
    "The whole recording is quieter than the threshold. Lower the threshold, for example to -60 dB, and try again.",
    { timeout: 60_000 },
  );
  await threshold.fill("-20");
  await shortest.fill("0.3");
  await file(page).setInputFiles(SPEECH);
  await run(page).click();
  expect(readMedia(await download(page, "memo-trimmed.wav")).durationSeconds).toBe(2.25);
});

test("takes exactly 10 minutes and refuses one millisecond more", async ({ page }, testInfo) => {
  await openTool(page, PATH);
  // 8 kHz mono: 10 minutes and 1 millisecond is a whole number of samples.
  await file(page).setInputFiles({
    name: "long.wav",
    mimeType: "audio/wav",
    buffer: speechWav([[600.001, true]], 8000, 1),
  });
  await expect(page.locator("#audio-silence-remover-file-error")).toHaveText(
    "long.wav: This recording is longer than 10 minutes. Cut it into shorter parts first.",
  );
  await file(page).setInputFiles({
    name: "ten.wav",
    mimeType: "audio/wav",
    buffer: speechWav([[600, true]], 8000, 1),
  });
  await expect(source(page)).toContainText("ten.wav: 600 s, 8000 Hz, mono");
  await run(page).click();
  expect(readMedia(await download(page, "ten-trimmed.wav")).durationSeconds).toBe(600);
  recordPath(testInfo, "10 minutes cleaned", "real");
});

test("refuses one byte over 100 MB and cleans a file of exactly 100 MB", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  // A 48 kHz stereo WAV header over silence, so the whole file has the exact size (9 min 6 s).
  const silent = (size: number) => {
    const bytes = Buffer.alloc(size);
    sineWav(0).copy(bytes, 0, 0, 44);
    bytes.writeUInt32LE(size - 8, 4);
    bytes.writeUInt32LE(size - 44, 40);
    return bytes;
  };
  const over = testInfo.outputPath("over.wav");
  writeFileSync(over, silent(LIMIT + 1));
  await file(page).setInputFiles(over);
  await expect(page.locator("#audio-silence-remover-file-error")).toHaveText(
    "over.wav: This file is larger than 100 MB.",
  );
  const full = testInfo.outputPath("full.wav");
  writeFileSync(full, silent(LIMIT));
  await file(page).setInputFiles(full);
  await expect(source(page)).toContainText("full.wav", { timeout: 60_000 });
  await expect(source(page)).toContainText("100 MB");
  await run(page).click();
  await expect(page.getByRole("alert")).toContainText("The whole recording is quieter", {
    timeout: 120_000,
  });
  recordPath(testInfo, "100 MB WAV decoded and judged silent", "real");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result, ${theme} theme`, async ({ page }, testInfo) => {
    recordPath(testInfo, "accessibility of the result", "real");
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(SPEECH);
    await expect(source(page)).toContainText("memo.wav");
    await run(page).click();
    await expect(page.getByRole("button", { name: "Download memo-trimmed.wav" })).toBeVisible({
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
