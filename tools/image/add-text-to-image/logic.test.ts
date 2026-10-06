import { describe, expect, it } from "vitest";
import {
  checkFile,
  checkLayer,
  checkLayers,
  cssFont,
  LIMITS,
  layout,
  MAX_PIXELS,
  MESSAGES,
  newLayer,
  outputName,
  withinPixelLimit,
} from "./logic";

describe("checkFile and the pixel limit", () => {
  it("takes JPG, PNG and WebP up to exactly 25 MB", () => {
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: LIMITS.maxInputBytes })).toBeNull();
    expect(checkFile({ name: "a.webp", type: "", size: 1 })).toBeNull();
    expect(checkFile({ name: "a.png", type: "image/png", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooLarge("25 MB"),
    );
    expect(checkFile({ name: "a.gif", type: "image/gif", size: 1 })).toBe(MESSAGES.notAnImage);
  });
  it("takes 4,096 by 4,096 pixels and refuses one row more", () => {
    expect(MAX_PIXELS).toBe(16_777_216);
    expect(withinPixelLimit(4096, 4096)).toBe(true);
    expect(withinPixelLimit(4096, 4097)).toBe(false);
    expect(withinPixelLimit(0, 10)).toBe(false);
  });
});

describe("layers", () => {
  it("makes new layers that can be drawn, each lower than the last", () => {
    const first = newLayer("a", 0);
    expect(checkLayer(first)).toEqual({});
    expect(newLayer("b", 1).y).toBeGreaterThan(first.y);
    expect(newLayer("z", 20).y).toBe(90);
  });
  it("names every problem with a layer", () => {
    const layer = {
      ...newLayer("a", 0),
      text: " ",
      size: 41,
      color: "red",
      x: -1,
      outline: Number.NaN,
    };
    expect(checkLayer(layer)).toEqual({
      text: MESSAGES.noText,
      size: MESSAGES.range("Text size", 1, 40),
      color: MESSAGES.color,
      x: MESSAGES.range("Left", 0, 100),
      outline: MESSAGES.range("Outline", 0, 20),
    });
    expect(checkLayer({ ...newLayer("a", 0), text: "x".repeat(201) }).text).toBe(MESSAGES.longText);
    expect(checkLayer({ ...newLayer("a", 0), text: "x".repeat(200) }).text).toBeUndefined();
  });
  it("takes 1 to 10 layers", () => {
    const ten = Array.from({ length: 10 }, (_, index) => newLayer(String(index), index));
    expect(checkLayers(ten)).toBeNull();
    expect(checkLayers([...ten, newLayer("x", 10)])).toBe(MESSAGES.tooManyLayers);
    expect(checkLayers([])).toBe(MESSAGES.noLayers);
  });
});

describe("layout", () => {
  it("sizes the text from the width and places each line", () => {
    const layer = { ...newLayer("a", 0), text: "One\nTwo", size: 10, x: 50, y: 20, outline: 5 };
    const shape = layout(layer, 1000, 500);
    expect(shape.pixels).toBe(100);
    expect(shape.outlineWidth).toBe(10);
    expect(shape.lines).toEqual([
      { text: "One", x: 500, y: 110 },
      { text: "Two", x: 500, y: 230 },
    ]);
  });
  it("writes the canvas font", () => {
    expect(cssFont({ font: "mono", bold: true }, 20)).toBe(
      'bold 20px "Courier New", Courier, monospace',
    );
    expect(cssFont({ font: "sans", bold: false }, 8)).toBe("8px Arial, Helvetica, sans-serif");
  });
  it("names the file in the format it was written", () => {
    expect(outputName("trip.JPG", "image/jpeg")).toBe("trip-text.jpg");
    expect(outputName("trip.webp", "image/png")).toBe("trip-text.png");
  });
});
