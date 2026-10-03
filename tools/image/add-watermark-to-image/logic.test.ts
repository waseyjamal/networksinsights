import { describe, expect, it } from "vitest";
import {
  checkFile,
  checkSettings,
  fontPixels,
  LIMITS,
  MESSAGES,
  outputName,
  placements,
  type Settings,
  withinPixelLimit,
} from "./logic";

const settings: Settings = {
  text: "© Example Studio",
  size: 5,
  color: "#ffffff",
  opacity: 50,
  position: "bottom-right",
  rotation: 0,
};

describe("checkSettings", () => {
  it("accepts the starting settings", () => {
    expect(checkSettings(settings)).toEqual({});
  });

  it("needs text, and takes 100 characters but not 101", () => {
    expect(checkSettings({ ...settings, text: "  " }).text).toBe(MESSAGES.noText);
    expect(checkSettings({ ...settings, text: "a".repeat(LIMITS.maxTextLength) })).toEqual({});
    expect(checkSettings({ ...settings, text: "a".repeat(101) }).text).toBe(MESSAGES.longText);
  });

  it("takes each range at its edges and refuses one over", () => {
    const edges = { ...settings, size: 50, opacity: 5, rotation: -180 };
    expect(checkSettings(edges)).toEqual({});
    expect(checkSettings({ ...edges, size: 51 }).size).toBe("Text size must be from 1 to 50.");
    expect(checkSettings({ ...edges, size: 0 }).size).toBeDefined();
    expect(checkSettings({ ...edges, opacity: 4 }).opacity).toBe("Opacity must be from 5 to 100.");
    expect(checkSettings({ ...edges, rotation: 181 }).rotation).toBe(
      "Rotation must be from -180 to 180.",
    );
    expect(checkSettings({ ...edges, rotation: Number.NaN }).rotation).toBeDefined();
  });

  it("refuses a colour that is not HEX", () => {
    expect(checkSettings({ ...settings, color: "white" }).color).toBe(MESSAGES.color);
  });
});

describe("placements", () => {
  it("puts a single copy in a corner, half the text height from both edges", () => {
    expect(placements(1000, 500, 200, 20, "bottom-right")).toEqual([{ x: 890, y: 480 }]);
    expect(placements(1000, 500, 200, 20, "top-left")).toEqual([{ x: 110, y: 20 }]);
    expect(placements(1000, 500, 200, 20, "center")).toEqual([{ x: 500, y: 250 }]);
  });

  it("tiles copies past every edge, so a rotated tile still covers the corners", () => {
    const spots = placements(1000, 500, 200, 20, "tile");
    expect(spots.length).toBeGreaterThan(20);
    expect(Math.min(...spots.map((s) => s.x))).toBeLessThan(0);
    expect(Math.max(...spots.map((s) => s.x))).toBeGreaterThan(1000);
    expect(Math.min(...spots.map((s) => s.y))).toBeLessThan(0);
    expect(Math.max(...spots.map((s) => s.y))).toBeGreaterThan(500);
  });
});

describe("sizes and files", () => {
  it("sizes the text from the shorter side, at least 8 pixels", () => {
    expect(fontPixels(2000, 1000, 5)).toBe(50);
    expect(fontPixels(100, 100, 1)).toBe(8);
  });

  it("takes exactly 25 MB and refuses one byte more", () => {
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: LIMITS.maxInputBytes })).toBeNull();
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: LIMITS.maxInputBytes + 1 })).toBe(
      "This file is larger than 25 MB.",
    );
    expect(checkFile({ name: "a.gif", type: "image/gif", size: 1 })).toBe(MESSAGES.notAnImage);
  });

  it("takes exactly 50 megapixels and refuses more", () => {
    expect(withinPixelLimit(10_000, 5_000)).toBe(true);
    expect(withinPixelLimit(10_001, 5_000)).toBe(false);
  });

  it("names the output after the input, in the format written", () => {
    expect(outputName("holiday.jpg", "image/jpeg")).toBe("holiday-watermarked.jpg");
    expect(outputName("photo.webp", "image/png")).toBe("photo-watermarked.png");
    expect(outputName(".png", "image/png")).toBe("image-watermarked.png");
  });
});
