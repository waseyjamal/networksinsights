import { describe, expect, it } from "vitest";
import {
  borderRect,
  cells,
  checkFile,
  checkSettings,
  cover,
  LAYOUTS,
  LIMITS,
  MESSAGES,
  outputName,
  room,
  type Settings,
  slotsOf,
} from "./logic";

const settings: Settings = {
  layout: "2-side",
  size: "square",
  spacing: 20,
  border: 0,
  borderColor: "#000000",
  background: "#ffffff",
  format: "png",
};

describe("files", () => {
  it("takes JPG, PNG and WebP up to exactly 25 MB, and six photos", () => {
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: LIMITS.maxInputBytes })).toBeNull();
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooLarge("25 MB"),
    );
    expect(checkFile({ name: "a.bmp", type: "image/bmp", size: 1 })).toBe(MESSAGES.notAnImage);
    expect(room(5)).toBe(1);
    expect(room(6)).toBe(0);
  });
});

describe("settings", () => {
  it("passes the defaults and the edges", () => {
    expect(checkSettings(settings)).toEqual({});
    expect(checkSettings({ ...settings, spacing: 100, border: 40 })).toEqual({});
  });
  it("refuses values past the edges, and colours that are not HEX", () => {
    expect(checkSettings({ ...settings, spacing: 101, border: 41, background: "white" })).toEqual({
      spacing: MESSAGES.range("Spacing", 0, 100),
      border: MESSAGES.range("Border", 0, 40),
      background: MESSAGES.color,
    });
    expect(checkSettings({ ...settings, spacing: -1, border: 1.5 })).toEqual({
      spacing: MESSAGES.range("Spacing", 0, 100),
      border: MESSAGES.range("Border", 0, 40),
    });
  });
  it("holds 2, 3, 4 or 6 photos", () => {
    expect(Object.keys(LAYOUTS).map((id) => slotsOf(id as keyof typeof LAYOUTS))).toEqual([
      2, 2, 3, 3, 4, 6,
    ]);
  });
});

describe("cells", () => {
  it("splits a square in two with spacing all round", () => {
    expect(cells("2-side", 1080, 1080, 20)).toEqual([
      { x: 20, y: 20, width: 510, height: 1040 },
      { x: 550, y: 20, width: 510, height: 1040 },
    ]);
  });
  it("lets the large cell span two rows", () => {
    const [big, top, bottom] = cells("3-left", 1080, 1080, 0);
    expect(big).toEqual({ x: 0, y: 0, width: 540, height: 1080 });
    expect(top).toEqual({ x: 540, y: 0, width: 540, height: 540 });
    expect(bottom).toEqual({ x: 540, y: 540, width: 540, height: 540 });
  });
  it("fills a 3 by 2 grid in reading order", () => {
    const grid = cells("6-grid", 1920, 1080, 0);
    expect(grid.map((cell) => [cell.x, cell.y])).toEqual([
      [0, 0],
      [640, 0],
      [1280, 0],
      [0, 540],
      [640, 540],
      [1280, 540],
    ]);
  });
});

describe("cover and borders", () => {
  it("cuts the sides of a wide photo in a square cell, and the top of a tall one", () => {
    expect(cover(400, 200, { x: 0, y: 0, width: 100, height: 100 })).toEqual({
      x: 100,
      y: 0,
      width: 200,
      height: 200,
    });
    expect(cover(200, 400, { x: 0, y: 0, width: 100, height: 100 })).toEqual({
      x: 0,
      y: 100,
      width: 200,
      height: 200,
    });
  });
  it("draws the border inside the cell", () => {
    expect(borderRect({ x: 10, y: 10, width: 100, height: 50 }, 10)).toEqual({
      x: 15,
      y: 15,
      width: 90,
      height: 40,
    });
  });
  it("names the collage after the first photo", () => {
    expect(outputName("beach.jpg", "png")).toBe("beach-collage.png");
    expect(outputName(undefined, "jpg")).toBe("photo-collage.jpg");
  });
});
