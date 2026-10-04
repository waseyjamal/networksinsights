import { describe, expect, it } from "vitest";
import {
  AUDIO_BITRATE,
  bitrateForTarget,
  checkFile,
  checkProbe,
  checkTarget,
  containerChoices,
  LIMITS,
  MESSAGES,
  outputName,
  outputSize,
  type Probe,
  type Support,
} from "./logic";

const MB = 1024 * 1024;

const probe = (
  width = 1920,
  height = 1080,
  durationSeconds = 60,
  audioCodec: string | null = "aac",
): Probe => ({
  durationSeconds,
  video: { codec: "avc", width, height, decoderConfig: null },
  audio:
    audioCodec === null
      ? null
      : { codec: audioCodec, sampleRate: 48_000, channels: 2, decoderConfig: null },
});

const all: Support = {
  decodeVideo: true,
  decodeAudio: true,
  encodeAvc: true,
  encodeVp9: true,
  encodeAac: true,
  encodeOpus: true,
};

describe("files", () => {
  it("accepts a file of exactly 500 MB and refuses one byte more", () => {
    const at = { name: "a.mp4", type: "video/mp4", size: LIMITS.maxInputBytes };
    expect(LIMITS.maxInputBytes).toBe(500 * MB);
    expect(checkFile(at)).toBeUndefined();
    expect(checkFile({ ...at, size: at.size + 1 })).toBe("This file is larger than 500 MB.");
    expect(checkFile({ name: "a.gif", type: "image/gif", size: 1 })).toBe(MESSAGES.notVideo);
    expect(checkFile({ name: "a.MOV", type: "", size: 1 })).toBeUndefined();
  });
});

describe("video limits", () => {
  it("accepts exactly ten minutes and refuses anything longer", () => {
    expect(checkProbe(probe(1920, 1080, 600))).toBeUndefined();
    expect(checkProbe(probe(1920, 1080, 600.001))).toBe("This video is longer than 10 minutes.");
  });

  it("accepts exactly 4K either way round, and refuses one pixel more on either side", () => {
    expect(checkProbe(probe(3840, 2160))).toBeUndefined();
    expect(checkProbe(probe(2160, 3840))).toBeUndefined();
    expect(checkProbe(probe(3841, 2160))).toBe(MESSAGES.tooBig(3841, 2160));
    expect(checkProbe(probe(3840, 2161))).toBe(MESSAGES.tooBig(3840, 2161));
    expect(checkProbe(probe(2161, 3840))).toBe(MESSAGES.tooBig(2161, 3840));
  });

  it("refuses a file with no picture", () => {
    expect(checkProbe({ ...probe(), video: null })).toBe(MESSAGES.noVideo);
  });
});

describe("output size", () => {
  it("brings 4K down to 1080p and never enlarges", () => {
    expect(outputSize(3840, 2160, "keep")).toEqual({ width: 1920, height: 1080 });
    expect(outputSize(1920, 1080, "keep")).toEqual({ width: 1920, height: 1080 });
    expect(outputSize(1920, 1081, "keep")).toEqual({ width: 1918, height: 1080 });
    expect(outputSize(1080, 1920, "720")).toEqual({ width: 720, height: 1280 });
    expect(outputSize(320, 240, "480")).toEqual({ width: 320, height: 240 });
  });

  it("keeps both sides even", () => {
    expect(outputSize(1281, 721, "keep")).toEqual({ width: 1282, height: 722 });
  });
});

describe("target size", () => {
  it("leaves room for the sound and the container", () => {
    const bitrate = bitrateForTarget(10, 60, "copy", AUDIO_BITRATE);
    expect(bitrate).toBe(Math.floor((10 * MB * 8 * 0.95) / 60 - AUDIO_BITRATE));
    expect(bitrateForTarget(10, 60, "drop", AUDIO_BITRATE)).toBe(
      Math.floor((10 * MB * 8 * 0.95) / 60),
    );
  });

  it("accepts exactly 0.5 MB and refuses anything less", () => {
    expect(checkTarget(0.5, 2 * MB, 8, "copy")).toBeUndefined();
    expect(checkTarget(0.49, 2 * MB, 8, "copy")).toBe(MESSAGES.targetInvalid(0.5));
    expect(checkTarget(Number.NaN, 2 * MB, 8, "copy")).toBe(MESSAGES.targetInvalid(0.5));
  });

  it("refuses a target that is not smaller than the file", () => {
    expect(checkTarget(2, 2 * MB, 8, "copy")).toBe(MESSAGES.targetTooLarge);
  });

  it("refuses a target that leaves the picture under 100 kbit/s", () => {
    // Ten minutes in 5 MB leaves about 66 kbit/s once the sound is counted.
    expect(checkTarget(5, 400 * MB, 600, "copy")).toBe(MESSAGES.targetTooSmall(5));
    expect(checkTarget(20, 400 * MB, 600, "copy")).toBeUndefined();
  });
});

describe("containers", () => {
  it("copies AAC or Opus into MP4 and Opus into WebM, and encodes otherwise", () => {
    expect(containerChoices(probe(), all).map((choice) => choice.audio)).toEqual([
      "copy",
      "encode",
    ]);
    expect(
      containerChoices(probe(1920, 1080, 60, "opus"), all).map((choice) => choice.audio),
    ).toEqual(["copy", "copy"]);
  });

  it("says the sound is dropped when the browser cannot keep it", () => {
    const firefox = { ...all, encodeAac: false };
    expect(
      containerChoices(probe(1920, 1080, 60, "vorbis"), firefox).map((choice) => choice.audio),
    ).toEqual(["drop", "encode"]);
    expect(containerChoices(probe(1920, 1080, 60, null), all)[0]?.audio).toBe("none");
  });

  it("offers nothing without a video decoder, and each container only with its encoder", () => {
    const none = containerChoices(probe(), { ...all, decodeVideo: false });
    expect(none.every((choice) => !choice.available)).toBe(true);
    expect(none[0]?.reason).toBe(MESSAGES.cannotDecode);
    const noVp9 = containerChoices(probe(), { ...all, encodeVp9: false });
    expect(noVp9.map((choice) => choice.available)).toEqual([true, false]);
    expect(noVp9[1]?.reason).toBe(MESSAGES.noVp9);
  });

  it("names the output", () => {
    expect(outputName("holiday.mov", "mp4")).toBe("holiday-compressed.mp4");
    expect(outputName("clip.webm", "webm")).toBe("clip-compressed.webm");
  });
});
