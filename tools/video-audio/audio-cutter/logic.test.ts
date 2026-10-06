import { describe, expect, it } from "vitest";
import {
  checkCut,
  checkFile,
  durationMs,
  formatTime,
  LIMITS,
  MESSAGES,
  modesFor,
  outputName,
  parseTime,
  supportNote,
} from "./logic";

describe("checkFile", () => {
  it("takes WAV, M4A, OGG and WebM, by type or extension", () => {
    expect(checkFile({ name: "a.wav", type: "audio/wav", size: 1 })).toBeUndefined();
    expect(checkFile({ name: "a.m4a", type: "", size: 1 })).toBeUndefined();
    expect(checkFile({ name: "a.ogg", type: "application/octet-stream", size: 1 })).toBeUndefined();
    expect(checkFile({ name: "a.mp3", type: "audio/mpeg", size: 1 })).toBe(MESSAGES.notAudio);
    expect(checkFile({ name: "a.txt", type: "text/plain", size: 1 })).toBe(MESSAGES.notAudio);
  });
  it("takes exactly 300 MB and refuses one byte more", () => {
    const wav = { name: "a.wav", type: "audio/wav" };
    expect(checkFile({ ...wav, size: LIMITS.maxInputBytes })).toBeUndefined();
    expect(checkFile({ ...wav, size: LIMITS.maxInputBytes + 1 })).toBe(MESSAGES.tooLarge("300 MB"));
  });
});

describe("parseTime and formatTime", () => {
  it("reads seconds, minutes and hours", () => {
    expect(parseTime("12")).toBe(12_000);
    expect(parseTime(" 1:05,25 ")).toBe(65_250);
    expect(parseTime("1:02:03.5")).toBe(3_723_500);
    expect(parseTime("1:60")).toBeUndefined();
    expect(parseTime("1.2345")).toBeUndefined();
    expect(parseTime("-1")).toBeUndefined();
  });
  it("writes m:ss with no trailing zeros", () => {
    expect(formatTime(65_250)).toBe("1:05.25");
    expect(formatTime(600_000)).toBe("10:00");
    expect(formatTime(3_723_500)).toBe("1:02:03.5");
    expect(durationMs(2.0004)).toBe(2000);
  });
});

describe("checkCut", () => {
  it("passes a cut inside the recording", () => {
    expect(checkCut("0.5", "1:00", 90_000, "copy")).toEqual({
      ok: true,
      startMs: 500,
      endMs: 60_000,
    });
  });
  it("refuses bad times, a backwards cut, one past the end and one too short", () => {
    expect(checkCut("x", "1", 2000, "wav")).toEqual({
      ok: false,
      error: MESSAGES.badTime("start"),
    });
    expect(checkCut("0", "", 2000, "wav")).toEqual({ ok: false, error: MESSAGES.badTime("end") });
    expect(checkCut("1", "1", 2000, "wav")).toEqual({ ok: false, error: MESSAGES.order });
    expect(checkCut("0", "2.001", 2000, "wav")).toEqual({
      ok: false,
      error: MESSAGES.pastEnd("0:02"),
    });
    expect(checkCut("0", "0.099", 2000, "wav")).toEqual({ ok: false, error: MESSAGES.tooShort });
    expect(checkCut("0", "0.1", 2000, "wav").ok).toBe(true);
  });
  it("takes an exact WAV cut of 10 minutes and refuses one millisecond more; copy has no such limit", () => {
    const hour = 3_600_000;
    expect(checkCut("0", "10:00", hour, "wav").ok).toBe(true);
    expect(checkCut("0", "10:00.001", hour, "wav")).toEqual({
      ok: false,
      error: MESSAGES.wavTooLong,
    });
    expect(checkCut("0", "30:00", hour, "copy").ok).toBe(true);
  });
});

describe("modes and notes", () => {
  it("offers copy first, then WAV, only where each works", () => {
    expect(modesFor(true, true)).toEqual(["copy", "wav"]);
    expect(modesFor(false, true)).toEqual(["wav"]);
    expect(modesFor(true, false)).toEqual(["copy"]);
    expect(modesFor(false, false)).toEqual([]);
  });
  it("explains what is missing", () => {
    expect(supportNote(true, true)).toBeUndefined();
    expect(supportNote(false, true)).toBe(MESSAGES.noCopy);
    expect(supportNote(true, false)).toBe(MESSAGES.noWav);
    expect(supportNote(false, false)).toBe(MESSAGES.cannot);
  });
  it("names the new file by mode", () => {
    expect(outputName("talk.m4a", "copy")).toBe("talk-cut.m4a");
    expect(outputName("talk.ogg", "wav")).toBe("talk-cut.wav");
    expect(outputName(".wav", "wav")).toBe("audio-cut.wav");
  });
});
