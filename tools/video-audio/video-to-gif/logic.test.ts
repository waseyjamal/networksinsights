import { describe, expect, it } from "vitest";
import {
  checkClip,
  checkFile,
  DEFAULTS,
  frameDelay,
  frameTimes,
  gifSize,
  LIMITS,
  MESSAGES,
  outputName,
  PALETTE_SAMPLE_PIXELS,
  paletteSample,
} from "./logic";

const ok = { ...DEFAULTS };

describe("files", () => {
  it("accepts a file of exactly 200 MB and refuses one byte more", () => {
    const at = { name: "a.webm", type: "video/webm", size: LIMITS.maxInputBytes };
    expect(LIMITS.maxInputBytes).toBe(200 * 1024 * 1024);
    expect(checkFile(at)).toBeUndefined();
    expect(checkFile({ ...at, size: at.size + 1 })).toBe("This file is larger than 200 MB.");
    expect(checkFile({ name: "a.gif", type: "image/gif", size: 1 })).toBe(MESSAGES.notVideo);
  });
});

describe("clip limits", () => {
  it("accepts the defaults", () => {
    expect(checkClip(ok, 60)).toEqual({});
  });

  it("accepts a length of exactly 30 seconds and refuses anything longer", () => {
    expect(checkClip({ ...ok, length: 30 }, 60)).toEqual({});
    expect(checkClip({ ...ok, length: 30.001 }, 60).length).toBe(MESSAGES.length(0.1, 30));
    expect(checkClip({ ...ok, length: 0.1 }, 60)).toEqual({});
    expect(checkClip({ ...ok, length: 0.09 }, 60).length).toBeDefined();
  });

  it("accepts a width of exactly 480 pixels and refuses 481", () => {
    expect(checkClip({ ...ok, width: 480 }, 60)).toEqual({});
    expect(checkClip({ ...ok, width: 481 }, 60).width).toBe(MESSAGES.width(16, 480));
    expect(checkClip({ ...ok, width: 16 }, 60)).toEqual({});
    expect(checkClip({ ...ok, width: 15 }, 60).width).toBeDefined();
    expect(checkClip({ ...ok, width: 320.5 }, 60).width).toBeDefined();
  });

  it("accepts exactly 15 frames a second and refuses 16", () => {
    expect(checkClip({ ...ok, fps: 15 }, 60)).toEqual({});
    expect(checkClip({ ...ok, fps: 16 }, 60).fps).toBe(MESSAGES.fps(1, 15));
    expect(checkClip({ ...ok, fps: 1 }, 60)).toEqual({});
    expect(checkClip({ ...ok, fps: 0 }, 60).fps).toBeDefined();
  });

  it("needs a start inside the video", () => {
    expect(checkClip({ ...ok, start: -1 }, 60).start).toBe(MESSAGES.start);
    expect(checkClip({ ...ok, start: 60 }, 60).start).toBe(MESSAGES.startAfterEnd("60 s"));
    expect(checkClip({ ...ok, start: Number.NaN }, 60).start).toBe(MESSAGES.start);
  });
});

describe("frames", () => {
  it("takes one frame every 1/fps for the length", () => {
    expect(frameTimes(0, 1, 4, 60)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(frameTimes(30, 30, 15, 120)).toHaveLength(450);
  });

  it("stops at the end of the video, and takes at least one frame", () => {
    expect(frameTimes(1, 5, 2, 2)).toEqual([1, 1.5]);
    expect(frameTimes(1.95, 1, 1, 2)).toEqual([1.95]);
  });

  it("never asks for a time before the first frame", () => {
    expect(frameTimes(0, 1, 2, 10, 0.04)).toEqual([0.04, 0.5]);
  });

  it("sizes the GIF to the chosen width, keeping the shape", () => {
    expect(gifSize(1920, 1080, 480)).toEqual({ width: 480, height: 270 });
    expect(gifSize(1080, 1920, 320)).toEqual({ width: 320, height: 569 });
    expect(gifSize(64, 48, 480)).toEqual({ width: 480, height: 360 });
  });

  it("gives the delay in milliseconds and names the file", () => {
    expect(frameDelay(10)).toBe(100);
    expect(frameDelay(15)).toBe(67);
    expect(outputName("cat.mov")).toBe("cat.gif");
  });
});

describe("palette sample", () => {
  const frame = (pixels: number) => {
    const rgba = new Uint8ClampedArray(pixels * 4);
    for (let i = 0; i < pixels; i++) rgba.set([i % 256, (i >> 8) % 256, 7, 255], i * 4);
    return rgba;
  };

  it("keeps a small frame as it is", () => {
    const small = frame(PALETTE_SAMPLE_PIXELS);
    expect(paletteSample(small, PALETTE_SAMPLE_PIXELS)).toBe(small);
  });

  it("takes an even sample of a large frame, whole pixels only", () => {
    const large = frame(480 * 360);
    const sample = paletteSample(large, PALETTE_SAMPLE_PIXELS);
    const step = Math.ceil((480 * 360) / PALETTE_SAMPLE_PIXELS);
    expect(sample.length / 4).toBeLessThanOrEqual(PALETTE_SAMPLE_PIXELS);
    expect(sample.length / 4).toBe(Math.ceil((480 * 360) / step));
    expect([...sample.subarray(0, 8)]).toEqual([0, 0, 7, 255, step % 256, 0, 7, 255]);
  });
});
