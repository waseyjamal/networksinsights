import { describe, expect, it } from "vitest";
import {
  checkFile,
  checkProbe,
  formatDuration,
  formatSize,
  isVideoFile,
  LIMITS,
  MESSAGES,
  outputChoices,
  outputName,
  type Probe,
} from "./logic";

const probe = (codec: string | null, durationSeconds = 2): Probe => ({
  durationSeconds,
  hasVideo: true,
  audio: codec === null ? null : { codec, sampleRate: 48_000, channels: 2, decoderConfig: null },
});

const all = { decodeAudio: true, encodeAac: true };
const none = { decodeAudio: false, encodeAac: false };

describe("files", () => {
  it("takes videos by media type, or by extension when the type is missing", () => {
    expect(isVideoFile({ name: "a.mp4", type: "video/mp4" })).toBe(true);
    expect(isVideoFile({ name: "a", type: "video/webm" })).toBe(true);
    expect(isVideoFile({ name: "a.MOV", type: "" })).toBe(true);
    expect(isVideoFile({ name: "a.mkv", type: "application/octet-stream" })).toBe(true);
    expect(isVideoFile({ name: "a.mp4", type: "text/plain" })).toBe(false);
    expect(isVideoFile({ name: "a.mp3", type: "" })).toBe(false);
  });

  it("accepts a file of exactly 1 GB and refuses one byte more", () => {
    const at = { name: "a.mp4", type: "video/mp4", size: LIMITS.maxInputBytes };
    expect(LIMITS.maxInputBytes).toBe(1024 ** 3);
    expect(checkFile(at)).toBeUndefined();
    expect(checkFile({ ...at, size: at.size + 1 })).toBe("This file is larger than 1 GB.");
    expect(checkFile({ name: "a.txt", type: "text/plain", size: 1 })).toBe(MESSAGES.notVideo);
  });
});

describe("length", () => {
  it("accepts exactly two hours and refuses anything longer", () => {
    expect(checkProbe(probe("aac", LIMITS.maxDurationSeconds))).toBeUndefined();
    expect(checkProbe(probe("aac", LIMITS.maxDurationSeconds + 0.001))).toBe(
      "This video is longer than 2 hours.",
    );
  });

  it("refuses a video with no sound", () => {
    expect(checkProbe(probe(null))).toBe(MESSAGES.noAudio);
  });

  it("offers WAV up to exactly 30 minutes, and not one moment more", () => {
    const at = outputChoices(probe("aac", LIMITS.maxWavSeconds), all)[1];
    expect(at).toEqual({ kind: "wav", available: true, copy: false });
    const over = outputChoices(probe("aac", LIMITS.maxWavSeconds + 0.001), all)[1];
    expect(over?.available).toBe(false);
    expect(over?.reason).toBe(MESSAGES.wavTooLong("30 minutes"));
  });
});

describe("outputs", () => {
  it("copies AAC into M4A with no codec at all", () => {
    expect(outputChoices(probe("aac"), none)[0]).toEqual({
      kind: "m4a",
      available: true,
      copy: true,
    });
  });

  it("re-encodes other sound as AAC only when the browser decodes it and encodes AAC", () => {
    expect(outputChoices(probe("opus"), all)[0]).toEqual({
      kind: "m4a",
      available: true,
      copy: false,
    });
    const firefox = outputChoices(probe("opus"), { decodeAudio: true, encodeAac: false });
    expect(firefox[0]?.available).toBe(false);
    expect(firefox[0]?.reason).toContain("cannot encode AAC");
    expect(firefox[1]?.available).toBe(true);
    const nothing = outputChoices(probe("opus"), none);
    expect(nothing.every((choice) => !choice.available)).toBe(true);
    expect(nothing[0]?.reason).toContain("cannot decode");
  });

  it("names the output after the video", () => {
    expect(outputName("holiday.mp4", "m4a")).toBe("holiday.m4a");
    expect(outputName("talk.final.webm", "wav")).toBe("talk.final.wav");
    expect(outputName(".mp4", "wav")).toBe("audio.wav");
  });
});

describe("formatting", () => {
  it("shows sizes and lengths as the page does", () => {
    expect(formatSize(1024 ** 3)).toBe("1 GB");
    expect(formatSize(1.5 * 1024 ** 2)).toBe("1.5 MB");
    expect(formatSize(1)).toBe("1 byte");
    expect(formatDuration(7200)).toBe("2 hours");
    expect(formatDuration(1800)).toBe("30 minutes");
    expect(formatDuration(2)).toBe("0:02");
    expect(formatDuration(3909)).toBe("1:05:09");
  });
});
