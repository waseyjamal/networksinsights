import { describe, expect, it } from "vitest";
import {
  checkCut,
  checkFile,
  containerFor,
  durationMs,
  formatSeconds,
  formatTime,
  LIMITS,
  MESSAGES,
  outputName,
  parseTime,
} from "./logic";

describe("parseTime", () => {
  it("reads seconds, minutes and hours into whole milliseconds", () => {
    expect(parseTime("12")).toBe(12_000);
    expect(parseTime("12.5")).toBe(12_500);
    expect(parseTime("0,25")).toBe(250);
    expect(parseTime("1:05")).toBe(65_000);
    expect(parseTime("1:05.125")).toBe(65_125);
    expect(parseTime("1:02:03")).toBe(3_723_000);
    expect(parseTime(" 0:08 ")).toBe(8_000);
  });

  it("has no float noise", () => {
    expect(parseTime("0.1")).toBe(100);
    expect(parseTime("2.3")).toBe(2_300);
    expect(parseTime("59.999")).toBe(59_999);
  });

  it("refuses what is not a time", () => {
    for (const text of ["", "abc", "-1", "1.2345", "1:60", "1:60:00", "1::2", "1e3"]) {
      expect(parseTime(text)).toBeUndefined();
    }
  });
});

describe("formatTime", () => {
  it("writes minutes and seconds, with the fraction only when there is one", () => {
    expect(formatTime(8_000)).toBe("0:08");
    expect(formatTime(2_500)).toBe("0:02.5");
    expect(formatTime(65_125)).toBe("1:05.125");
    expect(formatTime(3_723_000)).toBe("1:02:03");
    expect(formatSeconds(2_500)).toBe("2.5 seconds");
    expect(formatSeconds(1_000)).toBe("1 second");
  });
});

describe("checkCut", () => {
  it("takes a cut inside the video", () => {
    expect(checkCut("2.5", "5", 8_000)).toEqual({ ok: true, startMs: 2_500, endMs: 5_000 });
    expect(checkCut("0", "0:08", 8_000)).toEqual({ ok: true, startMs: 0, endMs: 8_000 });
  });

  it("refuses a cut in the wrong order, past the end or too short", () => {
    expect(checkCut("5", "2", 8_000)).toEqual({ ok: false, error: MESSAGES.order });
    expect(checkCut("5", "5", 8_000)).toEqual({ ok: false, error: MESSAGES.order });
    expect(checkCut("0", "8.001", 8_000)).toEqual({ ok: false, error: MESSAGES.pastEnd("0:08") });
    expect(checkCut("1", "1.099", 8_000)).toEqual({ ok: false, error: MESSAGES.tooShort });
    expect(checkCut("1", "1.1", 8_000)).toEqual({ ok: true, startMs: 1_000, endMs: 1_100 });
    expect(checkCut("x", "1", 8_000)).toEqual({ ok: false, error: MESSAGES.badTime("start") });
    expect(checkCut("0", "", 8_000)).toEqual({ ok: false, error: MESSAGES.badTime("end") });
    expect(MESSAGES.tooShort).toBe("The cut must be at least 0.1 seconds long.");
  });
});

describe("files", () => {
  it("checks the type and the 500 MB limit", () => {
    expect(checkFile({ name: "a.mp4", type: "video/mp4", size: LIMITS.maxInputBytes })).toBe(
      undefined,
    );
    expect(checkFile({ name: "a.mov", type: "", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooLarge("500 MB"),
    );
    expect(checkFile({ name: "a.avi", type: "video/x-msvideo", size: 1 })).toBe(MESSAGES.notVideo);
  });

  it("keeps WebM as WebM and writes MP4 for MP4 and MOV", () => {
    expect(containerFor("WebM")).toBe("webm");
    expect(containerFor("MP4")).toBe("mp4");
    expect(containerFor("QuickTime File Format")).toBe("mp4");
    expect(outputName("talk.mov", "mp4")).toBe("talk-trimmed.mp4");
    expect(outputName("clip.webm", "webm")).toBe("clip-trimmed.webm");
  });

  it("rounds the length down to whole milliseconds", () => {
    expect(durationMs(8)).toBe(8_000);
    expect(durationMs(2.5133333)).toBe(2_513);
  });
});
