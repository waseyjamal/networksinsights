import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/video-audio/audio-converter/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import {
  browserCodecs,
  expectProbeSane,
  hideFromPage,
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

// Audio converter against `wrangler dev` (real CSP and headers). Mediabunny runs in the tool's
// worker, and FLAC is written by libFLAC in WebAssembly in a worker of its own. Every result is
// downloaded and read back: its container header, codec, sample rate, channels and length. The
// WAV source is made in the test; the AAC and Opus sources are our own (e2e/fixtures/README.md).
// WAV to FLAC needs no browser codec, so it runs for real in every browser; the rest follow what
// the browser itself says it can do, asked here independently of the page.

test.use({ baseURL: edgeURL });
test.setTimeout(120_000);

const PATH = "/audio-converter/";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const WAV = { name: "tone.wav", mimeType: "audio/wav", buffer: sineWav(1.5) };
const M4A = { name: "voice.m4a", mimeType: "audio/mp4", buffer: fixture("tone-aac.m4a") };
const OGG = { name: "song.ogg", mimeType: "audio/ogg", buffer: fixture("tone-opus.ogg") };
const file = (page: Page) => page.locator("#audio-converter-file");

async function convert(page: Page, output: string, name: string) {
  await page.locator("#audio-converter-output").selectOption(output);
  await page.getByRole("button", { name: "Convert", exact: true }).click();
  const button = page.getByRole("button", { name: `Download ${name}` });
  await expect(button).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toBe(name);
  return readMedia(readFileSync((await download.path()) ?? ""));
}

const near = (actual: number, expected: number, tolerance = 0.05) => {
  expect(actual).toBeGreaterThan(expected - tolerance);
  expect(actual).toBeLessThan(expected + tolerance);
};

test("converts WAV to FLAC and to WAV with libFLAC and no browser codec, in every browser", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await file(page).setInputFiles(WAV);
  await expect(page.locator("#audio-converter-source")).toContainText(
    "tone.wav, 281.3 KB, 0:02, pcm-s16, 48000 Hz",
  );

  const flac = await convert(page, "flac", "tone.flac");
  expect(flac.container).toBe("flac");
  expect(flac.sampleRate).toBe(48_000);
  expect(flac.channels).toBe(2);
  near(flac.durationSeconds, 1.5, 0.001);
  recordPath(testInfo, "WAV to FLAC", "real");

  const wav = await convert(page, "wav", "tone-converted.wav");
  expect(wav.container).toBe("wav");
  near(wav.durationSeconds, 1.5, 0.001);
  recordPath(testInfo, "WAV to WAV", "real");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("encodes OGG Opus and M4A where the browser can, and says why where it cannot", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const can = await browserCodecs(page);
  await expectProbeSane(page);
  await file(page).setInputFiles(WAV);
  await expect(page.locator("#audio-converter-source")).toContainText("tone.wav");

  if (can.encodeOpus) {
    await page.locator("#audio-converter-output").selectOption("ogg");
    await page.locator("#audio-converter-bitrate").selectOption("96");
    const ogg = await convert(page, "ogg", "tone.ogg");
    expect(ogg.container).toBe("ogg");
    expect(ogg.codecs).toEqual(["Opus"]);
    near(ogg.durationSeconds, 1.5);
    recordPath(testInfo, "WAV to OGG Opus", "real");
  } else {
    await expect(page.locator('[data-unavailable="ogg"]')).toContainText(
      "Your browser cannot encode Opus.",
    );
    recordPath(testInfo, "WAV to OGG Opus", "message");
  }

  if (can.encodeAac) {
    const m4a = await convert(page, "m4a", "tone.m4a");
    expect(m4a.container).toBe("mp4");
    expect(m4a.codecs).toEqual(["mp4a"]);
    near(m4a.durationSeconds, 1.5, 0.1);
    recordPath(testInfo, "WAV to M4A", "real");
  } else {
    await expect(page.locator('[data-unavailable="m4a"]')).toContainText(
      "Your browser cannot encode AAC.",
    );
    recordPath(testInfo, "WAV to M4A", "message");
  }
});

test("decodes AAC and Opus files to FLAC where the browser can, and copies them where not", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const can = await browserCodecs(page);
  await expectProbeSane(page);
  for (const [source, decodes, copyAs, copyName] of [
    [M4A, can.decodeAac, "m4a", "voice-converted.m4a"],
    [OGG, can.decodeOpus, "ogg", "song-converted.ogg"],
  ] as const) {
    await file(page).setInputFiles(source);
    await expect(page.locator("#audio-converter-source")).toContainText(source.name);
    if (decodes) {
      const flac = await convert(page, "flac", source.name.replace(/\.\w+$/, ".flac"));
      expect(flac.container).toBe("flac");
      expect(flac.channels).toBe(2);
      near(flac.durationSeconds, 1, 0.05);
      recordPath(testInfo, `${source.name} to FLAC`, "real");
    } else {
      await expect(page.locator('[data-unavailable="flac"]')).toContainText(
        "Your browser cannot decode this sound.",
      );
      recordPath(testInfo, `${source.name} to FLAC`, "message");
    }
    // The same codec is copied, decoder or not.
    const copy = await convert(page, copyAs, copyName);
    near(copy.durationSeconds, 1, 0.05);
    await expect(page.locator("#audio-converter-result")).toContainText(
      "copied without re-encoding",
    );
    recordPath(testInfo, `${source.name} copied`, "real");
  }
});

test("without WebCodecs encoders, offers only WAV and FLAC for a WAV, and says why", async ({
  page,
}) => {
  recordPath(
    test.info(),
    "without WebCodecs encoders, offers only WAV and FLAC for a WAV, and says why, no conversion",
    "message",
  );
  await hideFromPage(page, ["AudioEncoder", "AudioDecoder"]);
  const errors = collectErrors(page);
  await openTool(page, PATH);
  expect(await page.evaluate(() => typeof AudioEncoder)).toBe("undefined");
  await file(page).setInputFiles(WAV);
  await expect(page.locator("#audio-converter-output option")).toHaveText([
    "WAV (uncompressed)",
    "FLAC (lossless)",
  ]);
  await expect(page.locator('[data-unavailable="ogg"]')).toContainText(
    "Your browser cannot encode Opus.",
  );
  await expect(page.locator('[data-unavailable="m4a"]')).toContainText(
    "Your browser cannot encode AAC.",
  );
  // An AAC file can still be copied, but nothing else, and the page says so.
  await file(page).setInputFiles(M4A);
  await expect(page.locator("#audio-converter-output option")).toHaveText(["M4A (AAC)"]);
  await expect(page.locator('[data-unavailable="wav"]')).toContainText(
    "Your browser cannot decode this sound.",
  );
  expect(errors).toEqual([]);
});

test("refuses MP3, a file that is not audio, and one that cannot be read", async ({ page }) => {
  recordPath(
    test.info(),
    "refuses MP3, a file that is not audio, and one that cannot be read, no conversion",
    "message",
  );
  await openTool(page, PATH);
  await file(page).setInputFiles({
    name: "song.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from("ID3"),
  });
  await expect(page.getByRole("status")).toContainText(
    "song.mp3: This file is not audio this tool reads.",
  );
  await file(page).setInputFiles({
    name: "broken.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("not audio at all, just some bytes"),
  });
  await expect(page.getByRole("status")).toContainText("broken.wav: This file is not audio");
  await expect(page.getByRole("button", { name: "Convert", exact: true })).toBeDisabled();
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
    await file(page).setInputFiles(WAV);
    await page.locator("#audio-converter-output").selectOption("flac");
    await page.getByRole("button", { name: "Convert", exact: true }).click();
    await expect(page.getByRole("button", { name: "Download tone.flac" })).toBeVisible({
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
  await expect(page.getByRole("region", { name: "Quick facts" })).toContainText("Up to 300 MB");
});
