import { describe, expect, it } from "vitest";
import {
  checkFile,
  checkSettings,
  fit,
  gifSize,
  LIMITS,
  MESSAGES,
  move,
  outputName,
  paletteSample,
  playSeconds,
  repeatFor,
  room,
} from "./logic";

describe("files", () => {
  it("takes JPG, PNG and WebP up to exactly 25 MB", () => {
    expect(
      checkFile({ name: "a.png", type: "image/png", size: LIMITS.maxInputBytes }),
    ).toBeUndefined();
    expect(checkFile({ name: "a.JPG", type: "", size: 1 })).toBeUndefined();
    expect(checkFile({ name: "a.png", type: "image/png", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooLarge("25 MB"),
    );
    expect(checkFile({ name: "a.gif", type: "image/gif", size: 1 })).toBe(MESSAGES.notAnImage);
  });
  it("leaves room for 100 pictures", () => {
    expect(room(0)).toBe(100);
    expect(room(99)).toBe(1);
    expect(room(100)).toBe(0);
  });
});

describe("checkSettings", () => {
  it("passes good settings, and needs two pictures", () => {
    expect(checkSettings(2, 480, 500)).toEqual({});
    expect(checkSettings(1, 480, 500)).toEqual({ count: MESSAGES.tooFew });
  });
  it("takes widths from 50 to 800 and delays from 20 to 10000, whole numbers only", () => {
    expect(checkSettings(2, 50, 20)).toEqual({});
    expect(checkSettings(2, 800, 10_000)).toEqual({});
    expect(checkSettings(2, 801, 10_001)).toEqual({
      width: MESSAGES.range("Width", 50, 800, "pixels"),
      delay: MESSAGES.range("Frame delay", 20, 10000, "milliseconds"),
    });
    expect(checkSettings(2, 49, 19)).toEqual({
      width: MESSAGES.range("Width", 50, 800, "pixels"),
      delay: MESSAGES.range("Frame delay", 20, 10000, "milliseconds"),
    });
    expect(Object.keys(checkSettings(2, 100.5, Number.NaN))).toEqual(["width", "delay"]);
  });
});

describe("sizes", () => {
  it("follows the first picture's shape, at most 800 high", () => {
    expect(gifSize(480, 400, 300)).toEqual({ width: 480, height: 360 });
    expect(gifSize(800, 100, 200)).toEqual({ width: 400, height: 800 });
    expect(gifSize(800, 800, 800)).toEqual({ width: 800, height: 800 });
  });
  it("fits a picture in the middle of a frame, in shape", () => {
    expect(fit(200, 100, 400, 400)).toEqual({ x: 0, y: 100, width: 400, height: 200 });
    expect(fit(100, 100, 400, 200)).toEqual({ x: 100, y: 0, width: 200, height: 200 });
  });
});

describe("the rest", () => {
  it("loops forever with 0 and once with no loop", () => {
    expect(repeatFor("forever")).toBe(0);
    expect(repeatFor("once")).toBe(-1);
  });
  it("moves pictures, not past the ends", () => {
    expect(move([1, 2, 3], 1, -1)).toEqual([2, 1, 3]);
    expect(move([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });
  it("samples large frames only", () => {
    const small = new Uint8ClampedArray(4 * 10);
    expect(paletteSample(small, 16)).toBe(small);
    expect(paletteSample(new Uint8ClampedArray(4 * 100), 10).length).toBe(40);
  });
  it("gives the length a loop plays, in GIF hundredths", () => {
    expect(playSeconds(4, 500)).toBe(2);
    expect(playSeconds(3, 333)).toBe(0.99);
    expect(outputName("beach.jpg")).toBe("beach-animation.gif");
  });
});
