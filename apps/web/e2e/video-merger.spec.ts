import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  EncodedPacket,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Output,
  WebMOutputFormat,
} from "../../../tools/node_modules/mediabunny/dist/modules/src/index.js";
import manifest from "../../../tools/video-audio/video-merger/tool.config";
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

// Video Merger against `wrangler dev` (real CSP and headers). Joining decodes and encodes, so each
// test asks the browser itself what it can do: where it can, the joined file is downloaded and its
// header read in Node; where it cannot (WebKit on Windows has no WebCodecs), the page must say so.
// Clips of an exact length are made here in Node with Mediabunny, by spacing the frames of a
// fixture out in time, so the 10-minute limit is tested at the millisecond.

test.use({ baseURL: edgeURL });
test.setTimeout(240_000);

const PATH = "/video-merger/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const MP4 = {
  name: "clip-h264-aac.mp4",
  mimeType: "video/mp4",
  buffer: fixture("clip-h264-aac.mp4"),
};
const WEBM = {
  name: "clip-vp9-opus.webm",
  mimeType: "video/webm",
  buffer: fixture("clip-vp9-opus.webm"),
};
const WIDE = { name: "wide.mp4", mimeType: "video/mp4", buffer: fixture("target-h264-aac.mp4") };
const files = (page: Page) => page.locator("#video-merger-files");
const clips = (page: Page) => page.getByRole("list", { name: "Clips to join" }).locator("li");
const join = (page: Page) => page.getByRole("button", { name: /^Join \d+ clips?$/ });

/** A WebM with the frames of the 31-second fixture spaced out to last exactly `seconds`, no sound. */
async function clipOf(name: string, seconds: number) {
  const source = fixture("long-31s-vp9-opus.webm");
  const build = async (stretch: number) => {
    const input = new Input({ source: new BufferSource(source), formats: ALL_FORMATS });
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error("no video in the fixture");
    const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
    const packets = new EncodedVideoPacketSource("vp9");
    output.addVideoTrack(packets);
    await output.start();
    const config = await video.getDecoderConfig();
    let first = true;
    for await (const packet of new EncodedPacketSink(video).packets()) {
      const spaced = new EncodedPacket(
        packet.data,
        packet.type,
        packet.timestamp * stretch,
        packet.duration * stretch,
      );
      await packets.add(spaced, first && config ? { decoderConfig: config } : undefined);
      first = false;
    }
    await output.finalize();
    const buffer = Buffer.from(output.target.buffer ?? new ArrayBuffer(0));
    const back = new Input({ source: new BufferSource(buffer), formats: ALL_FORMATS });
    const track = await back.getPrimaryVideoTrack();
    const length = (await track?.computeDuration()) ?? 0;
    return { buffer, length: length - Math.max(0, (await track?.getFirstTimestamp()) ?? 0) };
  };
  // The length is a straight line in the stretch: two tries find the stretch for the exact length.
  const a = await build(5);
  const b = await build(10);
  const made = await build(5 + ((seconds - a.length) * 5) / (b.length - a.length));
  expect(Math.round(made.length * 1000)).toBe(Math.round(seconds * 1000));
  return { name, mimeType: "video/webm", buffer: made.buffer };
}

async function download(page: Page, name: string) {
  const button = page.getByRole("button", { name: `Download ${name}` });
  await expect(button).toBeVisible({ timeout: 200_000 });
  const [saved] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(saved.suggestedFilename()).toBe(name);
  return readMedia(readFileSync((await saved.path()) ?? ""));
}

const containers = (page: Page) =>
  page
    .locator("#video-merger-container option")
    .evaluateAll((list) => list.map((option) => (option as HTMLOptionElement).value));

test("joins an MP4 and a WebM into one file where the browser can, in order", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  const can = await browserCodecs(page);
  await expectProbeSane(page);
  await files(page).setInputFiles([MP4, WEBM]);
  await expect(clips(page)).toHaveCount(2);
  await expect(clips(page).nth(1)).toContainText("0:02, 320 × 240", { timeout: 60_000 });
  await expect(page.locator("#video-merger-summary")).toHaveText(
    "2 clips, 0:04 in all. The joined video will be 320 × 240, the size of the first clip; other sizes get black bars.",
  );
  const canJoin = can.decodeAvc && can.decodeVp9 && (can.encodeAvc || can.encodeVp9);
  const withSound = can.decodeAac && can.decodeOpus;
  if (canJoin && (can.encodeAac || can.encodeOpus || !withSound)) {
    const offered = await containers(page);
    expect(offered.length).toBeGreaterThan(0);
    if (withSound) {
      expect(offered.includes("mp4")).toBe(can.encodeAvc && can.encodeAac);
    }
    const container = offered[0] ?? "mp4";
    await join(page).click();
    const joined = await download(page, `clip-h264-aac-joined.${container}`);
    expect(joined.container).toBe(container);
    expect(joined.durationSeconds).toBeGreaterThan(3.9);
    expect(joined.durationSeconds).toBeLessThan(4.15);
    if (container === "mp4") {
      expect(joined.width).toBe(320);
      expect(joined.height).toBe(240);
      expect(joined.codecs).toContain("avc1");
      if (withSound) expect(joined.codecs).toContain("mp4a");
    } else if (withSound) {
      expect(joined.codecs).toContain("A_OPUS");
    }
    recordPath(testInfo, `MP4 and WebM joined as ${container}`, "real");
  } else {
    await join(page).click();
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 60_000 });
    recordPath(testInfo, "joining MP4 and WebM", "message");
  }
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("the first clip sets the size, and Up, Down and Remove change the order", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const can = await browserCodecs(page);
  await files(page).setInputFiles([MP4, WIDE, WEBM]);
  await expect(clips(page).nth(2)).toContainText("0:02", { timeout: 60_000 });
  await page.getByRole("button", { name: "Move wide.mp4 up" }).click();
  await expect(clips(page).nth(0)).toContainText("1. wide.mp4");
  await expect(clips(page).nth(1)).toContainText("2. clip-h264-aac.mp4");
  await page.getByRole("button", { name: "Move clip-h264-aac.mp4 down" }).click();
  await expect(clips(page).nth(2)).toContainText("3. clip-h264-aac.mp4");
  await page.getByRole("button", { name: "Remove clip-vp9-opus.webm" }).click();
  await expect(clips(page)).toHaveCount(2);
  await expect(page.locator("#video-merger-summary")).toContainText(
    "The joined video will be 480 × 270, the size of the first clip",
  );
  if (can.decodeAvc && can.encodeAvc && (!can.decodeAac || can.encodeAac)) {
    await page.locator("#video-merger-container").selectOption("mp4");
    await join(page).click();
    const joined = await download(page, "wide-joined.mp4");
    expect(joined.width).toBe(480);
    expect(joined.height).toBe(270);
    expect(joined.durationSeconds).toBeGreaterThan(9.9);
    expect(joined.durationSeconds).toBeLessThan(10.2);
    recordPath(testInfo, "480 × 270 first, then 320 × 240, as MP4", "real");
  } else {
    recordPath(testInfo, "size rule shown on the page", "message");
  }
});

test("with no WebCodecs, says plainly that this browser cannot join", async ({
  page,
}, testInfo) => {
  await hideFromPage(page, ["VideoEncoder", "VideoDecoder", "AudioEncoder", "AudioDecoder"]);
  const errors = collectErrors(page);
  await openTool(page, PATH);
  expect(await page.evaluate(() => typeof VideoEncoder)).toBe("undefined");
  await files(page).setInputFiles([MP4, WEBM]);
  await expect(page.locator("#video-merger-support")).toHaveText(
    "Your browser cannot encode video, so it cannot join clips. A recent Chrome or Edge on a computer can.",
    { timeout: 60_000 },
  );
  await expect(clips(page).first()).toContainText("Your browser cannot decode this clip");
  await expect(page.locator("#video-merger-container")).toHaveCount(0);
  await join(page).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Clip 1, clip-h264-aac.mp4, cannot be joined here. Remove it to join the others.",
  );
  recordPath(testInfo, "no WebCodecs", "message");
  expect(errors).toEqual([]);
});

test("takes 10 clips, refuses the 11th, and needs at least 2", async ({ page }, testInfo) => {
  recordPath(testInfo, "clip count limits, no conversion", "message");
  await openTool(page, PATH);
  await files(page).setInputFiles([MP4]);
  await expect(clips(page).first()).toContainText("0:02", { timeout: 60_000 });
  await join(page).click();
  await expect(page.getByRole("alert")).toHaveText("Add at least 2 clips to join.");
  const eleven = Array.from({ length: 10 }, (_, index) => ({
    ...MP4,
    name: `part-${index + 2}.mp4`,
  }));
  await files(page).setInputFiles(eleven);
  await expect(clips(page)).toHaveCount(10);
  await expect(
    page.getByText("part-11.mp4: Up to 10 clips can be joined at a time."),
  ).toBeVisible();
  await expect(clips(page).nth(5)).toContainText("6. part-6.mp4");
  await expect(clips(page).last()).toContainText("10. part-10.mp4");
  await expect(clips(page).last()).toContainText("0:02", { timeout: 60_000 });
});

test("joins exactly 10 minutes in all, and refuses one millisecond more", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const can = await browserCodecs(page);
  const half = await clipOf("half.webm", 300);
  const over = await clipOf("over.webm", 300.001);
  await files(page).setInputFiles([half, over]);
  await expect(clips(page).nth(1)).toContainText("5:00.001", { timeout: 60_000 });
  await join(page).click();
  await expect(page.getByRole("alert")).toHaveText(
    "These clips last 10:00.001 in all. The joined video can be at most 10 minutes long: remove a clip.",
  );
  await page.getByRole("button", { name: "Remove over.webm" }).click();
  await files(page).setInputFiles([{ ...half, name: "half-2.webm" }]);
  await expect(page.locator("#video-merger-summary")).toContainText("2 clips, 10:00 in all.", {
    timeout: 60_000,
  });
  if (can.decodeVp9 && (can.encodeAvc || can.encodeVp9)) {
    await join(page).click();
    const container = (await containers(page))[0] ?? "mp4";
    const joined = await download(page, `half-joined.${container}`);
    expect(joined.durationSeconds).toBeGreaterThan(599);
    expect(joined.durationSeconds).toBeLessThan(601);
    recordPath(testInfo, "two 5-minute clips joined", "real");
  } else {
    recordPath(testInfo, "10-minute join", "message");
  }
});

test("refuses a clip one byte over 500 MB, and takes one of exactly 500 MB", async ({
  page,
}, testInfo) => {
  recordPath(testInfo, "file size limit, read only", "message");
  await openTool(page, PATH);
  // The fixture, then an MP4 "free" box of zeros that readers skip, to an exact size.
  const padded = (size: number) => {
    const bytes = Buffer.alloc(size);
    MP4.buffer.copy(bytes, 0);
    const rest = size - MP4.buffer.length;
    bytes.writeUInt32BE(rest, MP4.buffer.length);
    bytes.write("free", MP4.buffer.length + 4, "latin1");
    return bytes;
  };
  const overPath = testInfo.outputPath("over.mp4");
  writeFileSync(overPath, padded(LIMIT + 1));
  await files(page).setInputFiles(overPath);
  await expect(page.getByText("over.mp4: This file is larger than 500 MB.")).toBeVisible();
  const atPath = testInfo.outputPath("big.mp4");
  writeFileSync(atPath, padded(LIMIT));
  await files(page).setInputFiles(atPath);
  await expect(clips(page).first()).toContainText("0:02, 320 × 240", { timeout: 60_000 });
  await expect(clips(page).first()).toContainText("500 MB");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with clips listed, ${theme} theme`, async ({ page }, testInfo) => {
    recordPath(testInfo, "accessibility of the list", "message");
    await useTheme(page, theme);
    await openTool(page, PATH);
    await files(page).setInputFiles([MP4, WEBM]);
    await expect(clips(page).nth(1)).toContainText("0:02", { timeout: 60_000 });
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
