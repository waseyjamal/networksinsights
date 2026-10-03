import { describe, expect, it } from "vitest";
import {
  buildIco,
  centreSquare,
  checkFile,
  ICONS,
  LIMITS,
  linkTags,
  MESSAGES,
  manifestIcons,
  pngSize,
  withinPixelLimit,
} from "./logic";

/** A fake PNG: the signature and an IHDR chunk with this size, then some bytes. */
function fakePng(size: number, extra = 10): Uint8Array {
  const bytes = new Uint8Array(24 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, size);
  view.setUint32(20, size);
  return bytes;
}

describe("checkFile", () => {
  it("takes a picture of exactly 25 MB and refuses one byte more", () => {
    expect(checkFile({ name: "a.png", type: "image/png", size: LIMITS.maxInputBytes })).toBeNull();
    expect(checkFile({ name: "a.png", type: "image/png", size: LIMITS.maxInputBytes + 1 })).toBe(
      "This file is larger than 25 MB.",
    );
  });

  it("refuses other formats and reads the extension when the type is missing", () => {
    expect(checkFile({ name: "a.gif", type: "image/gif", size: 10 })).toBe(MESSAGES.notAnImage);
    expect(checkFile({ name: "a.svg", type: "", size: 10 })).toBe(MESSAGES.notAnImage);
    expect(checkFile({ name: "a.WEBP", type: "", size: 10 })).toBeNull();
  });
});

describe("centreSquare", () => {
  it("crops a wide picture at the sides and a tall one at top and bottom", () => {
    expect(centreSquare(300, 200)).toEqual({ x: 50, y: 0, side: 200 });
    expect(centreSquare(200, 301)).toEqual({ x: 0, y: 50, side: 200 });
    expect(centreSquare(64, 64)).toEqual({ x: 0, y: 0, side: 64 });
  });
});

describe("withinPixelLimit", () => {
  it("takes exactly 50 megapixels and refuses one more pixel", () => {
    expect(withinPixelLimit(10_000, 5_000)).toBe(true);
    expect(withinPixelLimit(50_000_001, 1)).toBe(false);
    expect(withinPixelLimit(0, 10)).toBe(false);
  });
});

describe("buildIco", () => {
  it("writes the header, one entry per image and the PNG data at the stated offsets", () => {
    const images = [16, 32, 48].map((size) => ({ size, png: fakePng(size, size) }));
    const ico = buildIco(images);
    const view = new DataView(ico.buffer);
    expect([view.getUint16(0, true), view.getUint16(2, true), view.getUint16(4, true)]).toEqual([
      0, 1, 3,
    ]);
    let expectedOffset = 6 + 3 * 16;
    for (const [index, image] of images.entries()) {
      const entry = 6 + index * 16;
      expect(view.getUint8(entry)).toBe(image.size);
      expect(view.getUint8(entry + 1)).toBe(image.size);
      expect(view.getUint16(entry + 4, true)).toBe(1);
      expect(view.getUint16(entry + 6, true)).toBe(32);
      expect(view.getUint32(entry + 8, true)).toBe(image.png.length);
      expect(view.getUint32(entry + 12, true)).toBe(expectedOffset);
      const stored = ico.subarray(expectedOffset, expectedOffset + image.png.length);
      expect(pngSize(stored)).toEqual({ width: image.size, height: image.size });
      expectedOffset += image.png.length;
    }
    expect(ico.length).toBe(expectedOffset);
  });

  it("writes 256 as 0 and refuses a size over 256", () => {
    const ico = buildIco([{ size: 256, png: fakePng(256) }]);
    expect(ico[6]).toBe(0);
    expect(() => buildIco([{ size: 257, png: fakePng(257) }])).toThrow(RangeError);
  });
});

describe("output text", () => {
  it("names every size the page lists", () => {
    expect(ICONS.map((icon) => icon.size)).toEqual([16, 32, 48, 180, 192, 512]);
    expect(linkTags()).toContain(
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
    );
    expect(JSON.parse(manifestIcons()).icons).toHaveLength(2);
  });

  it("pngSize refuses bytes that are not a PNG", () => {
    expect(pngSize(new Uint8Array(30))).toBeNull();
  });
});
