import { describe, expect, it } from "vitest";
import {
  checkFiles,
  flattenOnWhite,
  isHeicFile,
  LIMITS,
  MAX_PIXELS,
  MESSAGES,
  outputName,
  readHeifInfo,
  withinPixelLimit,
} from "./logic";

// HEIF files are built here box by box, with the layout libheif and the iPhone write: ftyp, then
// meta (hdlr, pitm, iprp with ipco and ipma), then mdat. No image data is needed: the size is read
// from the boxes alone, before anything is decoded.

const text = (value: string) => [...value].map((char) => char.charCodeAt(0));
const u16 = (value: number) => [(value >>> 8) & 255, value & 255];
const u32 = (value: number) => [
  (value >>> 24) & 255,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
];
const box = (type: string, ...content: number[][]) => {
  const body = content.flat();
  return [...u32(body.length + 8), ...text(type), ...body];
};
const fullBox = (type: string, version: number, flags: number, ...content: number[][]) =>
  box(type, [version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255], ...content);

interface Options {
  brands?: string[];
  width?: number;
  height?: number;
  /** irot angle in steps of 90 degrees anticlockwise. */
  rotation?: number;
  /** The primary item, and the item the properties are associated with. */
  primary?: number;
  associatedWith?: number;
  ipmaVersion?: number;
  wideIndex?: boolean;
}

function heif(options: Options = {}): Uint8Array {
  const [major = "heic", ...compatible] = options.brands ?? ["heic", "mif1", "heic"];
  const ftyp = box("ftyp", text(major), u32(0), ...compatible.map(text));
  const properties = [
    box("hvcC", [1, 2, 3]),
    fullBox("ispe", 0, 0, u32(options.width ?? 4032), u32(options.height ?? 3024)),
  ];
  if (options.rotation !== undefined) properties.push(box("irot", [options.rotation]));
  const indexes = properties.map((_, index) => index + 1);
  const wide = options.wideIndex ?? false;
  const version = options.ipmaVersion ?? 0;
  const item = options.associatedWith ?? options.primary ?? 1;
  const ipma = fullBox(
    "ipma",
    version,
    wide ? 1 : 0,
    u32(1),
    version < 1 ? u16(item) : u32(item),
    [indexes.length],
    ...indexes.map((index) => (wide ? u16(index | 0x8000) : [index | 0x80])),
  );
  const meta = fullBox(
    "meta",
    0,
    0,
    fullBox("hdlr", 0, 0, u32(0), text("pict"), u32(0), u32(0), u32(0), [0]),
    fullBox("pitm", 0, 0, u16(options.primary ?? 1)),
    box("iprp", box("ipco", ...properties), ipma),
  );
  return new Uint8Array([...ftyp, ...meta, ...box("mdat", [0, 0, 0, 0])]);
}

describe("readHeifInfo", () => {
  it("reads the size of an iPhone-style HEIC from its boxes", () => {
    expect(readHeifInfo(heif())).toEqual({ ok: true, width: 4032, height: 3024 });
  });

  it("swaps the sides when the photo is turned 90 or 270 degrees", () => {
    expect(readHeifInfo(heif({ rotation: 1 }))).toEqual({ ok: true, width: 3024, height: 4032 });
    expect(readHeifInfo(heif({ rotation: 3 }))).toEqual({ ok: true, width: 3024, height: 4032 });
    expect(readHeifInfo(heif({ rotation: 2 }))).toEqual({ ok: true, width: 4032, height: 3024 });
  });

  it("reads ipma version 1 and 16-bit property indexes", () => {
    expect(
      readHeifInfo(heif({ ipmaVersion: 1, wideIndex: true, width: 640, height: 480 })),
    ).toEqual({ ok: true, width: 640, height: 480 });
  });

  it("uses the properties of the primary item only", () => {
    expect(readHeifInfo(heif({ primary: 2, associatedWith: 1 }))).toEqual({
      ok: false,
      reason: "no-size",
    });
  });

  it("accepts HEIF brands and refuses AVIF and other files", () => {
    expect(readHeifInfo(heif({ brands: ["mif1", "heic"] })).ok).toBe(true);
    expect(readHeifInfo(heif({ brands: ["heix", "mif1"] })).ok).toBe(true);
    expect(readHeifInfo(heif({ brands: ["avif", "mif1", "miaf"] }))).toEqual({
      ok: false,
      reason: "not-heif",
    });
    expect(readHeifInfo(heif({ brands: ["isom", "mp41"] }))).toEqual({
      ok: false,
      reason: "not-heif",
    });
    expect(readHeifInfo(new Uint8Array(text("\x89PNG\r\n\x1a\n not a heif")))).toEqual({
      ok: false,
      reason: "not-heif",
    });
    expect(readHeifInfo(new Uint8Array())).toEqual({ ok: false, reason: "not-heif" });
  });

  it("says when the size cannot be found, rather than guessing", () => {
    const cut = heif().slice(0, 40);
    expect(readHeifInfo(cut)).toEqual({ ok: false, reason: "no-size" });
  });
});

describe("the pixel limit, read before decoding", () => {
  it("allows exactly 50 megapixels and refuses one row more", () => {
    // 10,000 by 5,000 is exactly 50,000,000 pixels.
    const exact = readHeifInfo(heif({ width: 10_000, height: 5_000 }));
    const over = readHeifInfo(heif({ width: 10_000, height: 5_001 }));
    if (!exact.ok || !over.ok) throw new Error("size not read");
    expect(exact.width * exact.height).toBe(MAX_PIXELS);
    expect(withinPixelLimit(exact.width, exact.height)).toBe(true);
    expect(withinPixelLimit(over.width, over.height)).toBe(false);
  });

  it("lets a 48 megapixel iPhone photo through", () => {
    const info = readHeifInfo(heif({ width: 8064, height: 6048 }));
    expect(info.ok && withinPixelLimit(info.width, info.height)).toBe(true);
  });

  it("refuses an empty size", () => {
    expect(withinPixelLimit(0, 100)).toBe(false);
  });

  it("names the size in the message", () => {
    expect(MESSAGES.tooManyPixels(10_000, 5_001)).toBe(
      "This photo is 10,000 × 5,001 pixels, more than the 50 megapixels this tool can hold in memory.",
    );
  });
});

describe("isHeicFile and checkFiles", () => {
  const file = (name: string, size = 1000, type = "") => ({ name, type, size });

  it("takes HEIC and HEIF by type or by extension", () => {
    expect(isHeicFile(file("IMG_0001.HEIC"))).toBe(true);
    expect(isHeicFile(file("photo.heif"))).toBe(true);
    expect(isHeicFile(file("photo.hif", 10, "application/octet-stream"))).toBe(true);
    expect(isHeicFile(file("photo", 10, "image/heic"))).toBe(true);
    expect(isHeicFile(file("photo.jpg", 10, "image/jpeg"))).toBe(false);
    expect(isHeicFile(file("photo.heic", 10, "image/jpeg"))).toBe(false);
  });

  it("allows a file of exactly 50 MB and refuses one byte more", () => {
    const { accepted, rejected } = checkFiles([
      file("exact.heic", LIMITS.maxInputBytes),
      file("over.heic", LIMITS.maxInputBytes + 1),
    ]);
    expect(accepted.map((entry) => entry.name)).toEqual(["exact.heic"]);
    expect(rejected).toEqual([{ name: "over.heic", reason: "This file is larger than 50 MB." }]);
  });

  it("takes 20 files and refuses the 21st", () => {
    const files = Array.from({ length: 21 }, (_, index) => file(`photo-${index + 1}.heic`));
    const { accepted, rejected } = checkFiles(files);
    expect(accepted).toHaveLength(20);
    expect(rejected).toEqual([
      { name: "photo-21.heic", reason: "Only 20 files can be converted at once." },
    ]);
    expect(checkFiles([file("more.heic")], 20).accepted).toHaveLength(0);
  });

  it("refuses a file that is not HEIC", () => {
    expect(checkFiles([file("notes.txt", 10, "text/plain")]).rejected).toEqual([
      { name: "notes.txt", reason: MESSAGES.notHeic },
    ]);
  });
});

describe("flattenOnWhite", () => {
  it("lays transparent pixels on white and leaves opaque ones alone", () => {
    const data = new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0, 200, 0, 0, 128]);
    flattenOnWhite(data);
    expect([...data]).toEqual([10, 20, 30, 255, 255, 255, 255, 255, 227, 127, 127, 255]);
  });
});

describe("outputName", () => {
  it("keeps the name and changes the extension", () => {
    expect(outputName("IMG_0420.HEIC", "jpg")).toBe("IMG_0420.jpg");
    expect(outputName("holiday photo.heif", "png")).toBe("holiday photo.png");
    expect(outputName(".heic", "jpg")).toBe("photo.jpg");
  });
});
