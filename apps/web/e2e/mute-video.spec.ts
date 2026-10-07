import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  Conversion,
  EncodedPacketSink,
  Input,
  MkvOutputFormat,
  MovOutputFormat,
  Output,
  type OutputFormat,
  WebMOutputFormat,
} from "../../../tools/node_modules/mediabunny/dist/modules/src/index.js";
import manifest from "../../../tools/video-audio/mute-video/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { recordPath } from "./media";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Mute Video against `wrangler dev` (real CSP and headers). Muting copies packets and uses no
// codec, so it is a real run in every browser. For each container (MP4 and WebM fixtures, and MOV
// and MKV copies of them made here in Node with Mediabunny), the downloaded file is read back in
// Node: it must be the same kind of file, have no audio track, and hold a video track with the
// same codec, the same number of packets and byte-identical packet data, with the same timestamps,
// as the original. That is what "copied, not re-encoded" on the page means. A video with no audio
// track is reported as such, not as an error.

test.use({ baseURL: edgeURL });
test.setTimeout(180_000);

const PATH = "/mute-video/";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const MP4 = fixture("clip-h264-aac.mp4");
const WEBM = fixture("clip-vp9-opus.webm");
const file = (page: Page) => page.locator("#mute-video-file");

/** The file remuxed (packets copied) into `format`, with or without its sound. */
async function remux(source: Buffer, format: OutputFormat, keepAudio: boolean) {
  const input = new Input({ source: new BufferSource(source), formats: ALL_FORMATS });
  const output = new Output({ format, target: new BufferTarget() });
  const conversion = await Conversion.init({
    input,
    output,
    audio: keepAudio ? {} : { discard: true },
    copy: { mode: "forced" },
    showWarnings: false,
  });
  expect(conversion.isValid).toBe(true);
  await conversion.execute();
  return Buffer.from(output.target.buffer ?? new ArrayBuffer(0));
}

/** What a video file holds: its format, its audio tracks, and its video packets. */
async function contents(bytes: Buffer) {
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  const video = await input.getPrimaryVideoTrack();
  if (!video) throw new Error("no video track");
  const packets: string[] = [];
  for await (const packet of new EncodedPacketSink(video).packets()) {
    packets.push(
      `${packet.timestamp.toFixed(6)} ${packet.type} ${createHash("sha256").update(packet.data).digest("hex")}`,
    );
  }
  return {
    format: (await input.getFormat()).name,
    audioTracks: (await input.getAudioTracks()).length,
    codec: video.codec,
    packets,
  };
}

async function download(page: Page, name: string) {
  const button = page.getByRole("button", { name: `Download ${name}` });
  await expect(button).toBeVisible({ timeout: 120_000 });
  const [saved] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

const CASES = [
  {
    name: "beach.mp4",
    mimeType: "video/mp4",
    make: async () => MP4,
    out: "beach-muted.mp4",
    kind: "MP4",
  },
  {
    name: "talk.webm",
    mimeType: "video/webm",
    make: async () => WEBM,
    out: "talk-muted.webm",
    kind: "WebM",
  },
  {
    name: "phone.mov",
    mimeType: "video/quicktime",
    make: () => remux(MP4, new MovOutputFormat(), true),
    out: "phone-muted.mov",
    kind: "MOV",
  },
  {
    name: "screen.mkv",
    mimeType: "video/x-matroska",
    make: () => remux(WEBM, new MkvOutputFormat(), true),
    out: "screen-muted.mkv",
    kind: "MKV",
  },
] as const;

for (const item of CASES) {
  test(`mutes ${item.kind} by copying the video packets`, async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    const violations = await watchViolations(page);
    const buffer = await item.make();
    const original = await contents(buffer);
    expect(original.audioTracks).toBe(1);
    await openTool(page, PATH);
    await expect(page.getByText("Copied, not re-encoded")).toBeVisible();
    await file(page).setInputFiles({ name: item.name, mimeType: item.mimeType, buffer });
    await expect(page.locator("#mute-video-original")).toContainText(
      `${item.name}: ${item.kind}, 0:02, 320 × 240, 1 audio track`,
      { timeout: 60_000 },
    );
    await page.getByRole("button", { name: "Remove sound" }).click();
    const muted = await download(page, item.out);
    const after = await contents(muted);
    expect(after.format).toBe(original.format);
    expect(after.audioTracks).toBe(0);
    expect(after.codec).toBe(original.codec);
    expect(after.packets.length).toBeGreaterThan(40);
    expect(after.packets).toEqual(original.packets);
    expect(muted.length).toBeLessThan(buffer.length);
    recordPath(testInfo, `${item.kind} muted, video packets identical`, "real");
    expect(errors).toEqual([]);
    expect(await violations()).toEqual([]);
  });
}

test("says a video with no audio track has nothing to remove", async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const silent = await remux(WEBM, new WebMOutputFormat(), false);
  expect((await contents(silent)).audioTracks).toBe(0);
  await openTool(page, PATH);
  await file(page).setInputFiles({ name: "silent.webm", mimeType: "video/webm", buffer: silent });
  await expect(page.locator("#mute-video-original")).toContainText("no sound", { timeout: 60_000 });
  await expect(page.locator("#mute-video-silent")).toContainText(
    "No audio track found: this video is already silent, so there is nothing to remove.",
  );
  await expect(page.getByRole("button", { name: "Remove sound" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("This file was not opened")).toHaveCount(0);
  recordPath(testInfo, "video without sound", "message");
  expect(errors).toEqual([]);
});

test("refuses a file that is not a video", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a video"),
  });
  await expect(
    page.getByText(
      "notes.txt: This file is not a video this tool can open. Choose an MP4, MOV, WebM or MKV file.",
    ),
  ).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles({ name: "beach.mp4", mimeType: "video/mp4", buffer: MP4 });
    await page.getByRole("button", { name: "Remove sound" }).click({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Download beach-muted.mp4" })).toBeVisible({
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
