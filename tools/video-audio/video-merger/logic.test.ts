import { describe, expect, it } from "vitest";
import {
  AUDIO_RATE,
  checkFile,
  checkList,
  createResampler,
  durationMs,
  formatTime,
  framesFor,
  LIMITS,
  MESSAGES,
  move,
  outputName,
  outputSize,
  planar,
  room,
  toStereo,
} from "./logic";

describe("checkFile and room", () => {
  it("takes MP4, MOV and WebM, by type or extension", () => {
    expect(checkFile({ name: "a.mp4", type: "video/mp4", size: 1 })).toBeUndefined();
    expect(checkFile({ name: "a.MOV", type: "", size: 1 })).toBeUndefined();
    expect(checkFile({ name: "a.avi", type: "video/x-msvideo", size: 1 })).toBe(MESSAGES.notVideo);
  });
  it("takes exactly 500 MB and refuses one byte more", () => {
    const mp4 = { name: "a.mp4", type: "video/mp4" };
    expect(checkFile({ ...mp4, size: LIMITS.maxInputBytes })).toBeUndefined();
    expect(checkFile({ ...mp4, size: LIMITS.maxInputBytes + 1 })).toBe(MESSAGES.tooLarge("500 MB"));
  });
  it("leaves room for ten clips", () => {
    expect(room(0)).toBe(10);
    expect(room(9)).toBe(1);
    expect(room(10)).toBe(0);
    expect(room(12)).toBe(0);
  });
});

describe("checkList", () => {
  it("needs two clips", () => {
    expect(checkList([1000])).toBe(MESSAGES.tooFew);
    expect(checkList([1000, 1000])).toBeUndefined();
  });
  it("takes exactly 10 minutes in all and refuses one millisecond more", () => {
    expect(checkList([300_000, 300_000])).toBeUndefined();
    expect(checkList([300_000, 300_001])).toBe(MESSAGES.tooLong("10:00.001"));
  });
  it("rounds lengths to the millisecond", () => {
    expect(durationMs(2.0004)).toBe(2000);
    expect(durationMs(2.0006)).toBe(2001);
  });
});

describe("move", () => {
  it("moves up and down, and not past the ends", () => {
    expect(move(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(move(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(move(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(move(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });
});

describe("outputSize", () => {
  it("keeps the first clip's size when it fits, rounded to even sides", () => {
    expect(outputSize(320, 240)).toEqual({ width: 320, height: 240 });
    expect(outputSize(321, 241)).toEqual({ width: 320, height: 240 });
  });
  it("scales a large clip down to fit 1920 by 1080, or 1080 by 1920 upright", () => {
    expect(outputSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize(2160, 3840)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(4000, 1000)).toEqual({ width: 1920, height: 480 });
  });
});

describe("sound", () => {
  it("mixes mono to both sides and drops extra channels", () => {
    const mono = Float32Array.from([1, 2]);
    expect(toStereo([mono])).toEqual([mono, mono]);
    const [l, r] = toStereo([mono, Float32Array.from([3, 4]), Float32Array.from([5, 6])]);
    expect([...l, ...r]).toEqual([1, 2, 3, 4]);
    expect([...planar(Float32Array.from([1]), Float32Array.from([2]))]).toEqual([1, 2]);
  });
  it("passes sound at the same rate through, piece after piece, without a gap", () => {
    const resample = createResampler(48_000, 48_000);
    const first = resample([Float32Array.from([0, 1, 2]), Float32Array.from([0, 1, 2])]);
    const second = resample([Float32Array.from([3, 4]), Float32Array.from([3, 4])]);
    expect([...first[0], ...second[0]]).toEqual([0, 1, 2, 3]);
  });
  it("doubles the samples from 24 kHz to 48 kHz, between pieces too", () => {
    const resample = createResampler(24_000, 48_000);
    const a = resample([Float32Array.from([0, 2]), Float32Array.from([0, 2])]);
    const b = resample([Float32Array.from([4, 6]), Float32Array.from([4, 6])]);
    expect([...a[0], ...b[0]]).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("makes about the right number of samples from 44.1 kHz", () => {
    const resample = createResampler(44_100, AUDIO_RATE);
    let made = 0;
    for (let piece = 0; piece < 10; piece++) {
      const plane = new Float32Array(4410);
      made += resample([plane, plane])[0].length;
    }
    expect(Math.abs(made - AUDIO_RATE)).toBeLessThanOrEqual(2);
    expect(resample([new Float32Array(0), new Float32Array(0)])[0].length).toBe(0);
  });
  it("counts frames at 48 kHz", () => {
    expect(framesFor(1.5)).toBe(72_000);
  });
});

describe("names and times", () => {
  it("names the joined file after the first clip", () => {
    expect(outputName("holiday.mov", "mp4")).toBe("holiday-joined.mp4");
    expect(outputName(undefined, "webm")).toBe("video-joined.webm");
    expect(formatTime(62_500)).toBe("1:02.5");
  });
});
