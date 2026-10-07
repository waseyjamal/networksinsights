import exifr from "exifr";
import { expect, describe as group, it } from "vitest";
import {
  app1Exif,
  buildTiff,
  checkFile,
  describe,
  formatDate,
  jpegBlocks,
  jpegSegments,
  LIMITS,
  MESSAGES,
  outputName,
  pngBlocks,
  sniff,
  stripJpeg,
  webpBlocks,
} from "./logic";

// A JPEG made of real marker segments around a stand-in for compressed data. exifr reads only the
// segments, so it reads these files as it reads a camera's. The location is synthetic: open sea
// near 0°, 0°.

const bytes = (...items: Array<number | string | Uint8Array>) => {
  const out: number[] = [];
  for (const item of items) {
    if (typeof item === "number") out.push(item);
    else if (typeof item === "string") for (const c of item) out.push(c.charCodeAt(0));
    else out.push(...item);
  }
  return new Uint8Array(out);
};

const segment = (marker: number, payload: Uint8Array) =>
  bytes(0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, payload);

const TIFF = buildTiff(
  [
    { tag: 0x010f, type: "ascii", value: "TestCam" },
    { tag: 0x0110, type: "ascii", value: "Model X1" },
    { tag: 0x0112, type: "short", value: [6] },
    { tag: 0x0131, type: "ascii", value: "Synthetic 1.0" },
  ],
  {
    exif: [{ tag: 0x9003, type: "ascii", value: "2024:05:06 07:08:09" }],
    gps: [
      { tag: 0x0001, type: "ascii", value: "N" },
      { tag: 0x0002, type: "rational", value: [0, 1, 15, 1, 0, 1] },
      { tag: 0x0003, type: "ascii", value: "W" },
      { tag: 0x0004, type: "rational", value: [0, 1, 30, 1, 0, 1] },
    ],
  },
);

const JFIF = segment(0xe0, bytes("JFIF", 0, 1, 1, 0, 0, 1, 0, 1, 0, 0));
const XMP = segment(
  0xe1,
  bytes("http://ns.adobe.com/xap/1.0/", 0, '<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>'),
);
const IPTC = segment(0xed, bytes("Photoshop 3.0", 0, "8BIM", 0x04, 0x04, 0, 0, 0, 0, 0, 0));
const ICC = segment(0xe2, bytes("ICC_PROFILE", 0, 1, 1, "fake"));
const COMMENT = segment(0xfe, bytes("synthetic comment"));
const TABLES = segment(0xdb, bytes(0, ...new Array(64).fill(1)));
const PICTURE = bytes(
  segment(0xda, bytes(1, 1, 0, 0, 63, 0)),
  0x12,
  0xff,
  0x00,
  0x34,
  0xff,
  0xd0,
  0x56,
  0xff,
  0xd9,
);

function photo(tiff: Uint8Array = TIFF) {
  return bytes(0xff, 0xd8, JFIF, app1Exif(tiff), XMP, IPTC, ICC, COMMENT, TABLES, PICTURE, "junk");
}

group("checkFile", () => {
  it("accepts JPG, PNG and WebP and refuses anything else", () => {
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: 10 })).toBeNull();
    expect(checkFile({ name: "a.png", type: "", size: 10 })).toBeNull();
    expect(checkFile({ name: "a.webp", type: "image/webp", size: 10 })).toBeNull();
    expect(checkFile({ name: "a.gif", type: "image/gif", size: 10 })).toBe(MESSAGES.type);
  });

  it("refuses a file over the size limit", () => {
    const size = LIMITS.maxInputBytes + 1;
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size })).toBe(MESSAGES.tooBig("50 MB"));
  });

  it("knows the format from the first bytes", () => {
    expect(sniff(photo())).toBe("jpeg");
    expect(sniff(bytes(0x89, "PNG", 13, 10, 26, 10))).toBe("png");
    expect(sniff(bytes("RIFF", 0, 0, 0, 0, "WEBP"))).toBe("webp");
    expect(sniff(bytes("GIF89a"))).toBeNull();
  });
});

group("the sample photo", () => {
  it("is read by exifr with its camera, date, orientation and location", async () => {
    const tags = await exifr.parse(photo(), { gps: true, translateValues: false });
    expect(tags.Make).toBe("TestCam");
    expect(tags.Model).toBe("Model X1");
    expect(tags.Orientation).toBe(6);
    expect(tags.latitude).toBeCloseTo(0.25, 6);
    expect(tags.longitude).toBeCloseTo(-0.5, 6);
  });

  it("lists its metadata blocks, but not JFIF or the picture tables", () => {
    expect(jpegBlocks(photo())).toEqual(["EXIF", "XMP", "IPTC", "ICC colour profile", "Comment"]);
  });
});

group("stripJpeg", () => {
  it("leaves no camera, location, XMP, IPTC or comment, and keeps one orientation tag", async () => {
    const out = stripJpeg(photo(), 6);
    const tags = await exifr.parse(out, {
      gps: true,
      xmp: true,
      iptc: true,
      translateValues: false,
    });
    expect(tags).toEqual({ Orientation: 6 });
    expect(jpegBlocks(out)).toEqual(["EXIF", "ICC colour profile"]);
  });

  it("copies the picture data byte for byte and drops what follows the end marker", () => {
    const out = stripJpeg(photo(), 6);
    const tail = out.subarray(out.length - TABLES.length - PICTURE.length);
    expect([...tail]).toEqual([...TABLES, ...PICTURE]);
    expect([...out.subarray(0, 2 + JFIF.length)]).toEqual([0xff, 0xd8, ...JFIF]);
  });

  it("writes no EXIF at all when the orientation is normal or missing", async () => {
    for (const orientation of [1, null]) {
      const out = stripJpeg(photo(), orientation);
      expect(jpegBlocks(out)).toEqual(["ICC colour profile"]);
      expect(await exifr.parse(out)).toBeUndefined();
    }
  });

  it("drops application blocks between the scans of a progressive JPEG", () => {
    const second = bytes(segment(0xe1, bytes("Exif", 0, 0, "x")), segment(0xc4, bytes(0, 1)));
    const file = bytes(0xff, 0xd8, TABLES, PICTURE.subarray(0, -2), second, PICTURE);
    const out = stripJpeg(file, null);
    expect(out.length).toBe(file.length - (second.length - segment(0xc4, bytes(0, 1)).length));
    expect([...out.subarray(-2)]).toEqual([0xff, 0xd9]);
  });

  it("refuses a file that is not a JPEG or has no picture data", () => {
    expect(() => stripJpeg(bytes("GIF89a"), null)).toThrow();
    expect(() => stripJpeg(bytes(0xff, 0xd8, TABLES), null)).toThrow();
    expect(() => jpegSegments(bytes(0xff, 0xd8, 0xff, 0xe1, 0x40, 0))).toThrow();
  });
});

group("describe", () => {
  it("turns exifr's tags into the rows the page shows", async () => {
    const tags = await exifr.parse(photo(), {
      gps: true,
      translateValues: false,
      reviveValues: false,
    });
    const { rows, location, orientation } = describe(tags);
    expect(rows).toEqual([
      { label: "Camera", value: "TestCam Model X1" },
      { label: "Date taken", value: "2024-05-06 07:08:09" },
      { label: "Software", value: "Synthetic 1.0" },
      { label: "Orientation", value: "6: Turned 90° clockwise" },
      { label: "GPS location", value: "0.250000° N, 0.500000° W" },
    ]);
    expect(location).toEqual({ latitude: 0.25, longitude: -0.5 });
    expect(orientation).toBe(6);
  });

  it("shows nothing and no location for a photo without tags", () => {
    expect(describe({})).toEqual({ rows: [], location: null, orientation: null });
    expect(describe({ latitude: 200, longitude: 0 }).location).toBeNull();
  });

  it("does not repeat the make when the model already starts with it", () => {
    expect(describe({ Make: "Cam", Model: "Cam 5" }).rows).toEqual([
      { label: "Camera", value: "Cam 5" },
    ]);
    expect(formatDate("not a date")).toBe("not a date");
  });
});

group("PNG and WebP blocks", () => {
  const chunk = (type: string, data: Uint8Array) =>
    bytes(0, 0, data.length >> 8, data.length & 0xff, type, data, 0, 0, 0, 0);

  it("names the metadata chunks of a PNG", () => {
    const png = bytes(
      0x89,
      "PNG",
      13,
      10,
      26,
      10,
      chunk("IHDR", new Uint8Array(13)),
      chunk("eXIf", TIFF),
      chunk("iTXt", bytes("XML:com.adobe.xmp", 0)),
      chunk("tEXt", bytes("Author", 0, "x")),
      chunk("IEND", new Uint8Array(0)),
    );
    expect(pngBlocks(png)).toEqual(["EXIF", "XMP", "Text"]);
  });

  it("names the metadata chunks of a WebP", () => {
    const riff = (type: string, data: Uint8Array) =>
      bytes(type, data.length & 0xff, data.length >> 8, 0, 0, data, data.length % 2 ? 0 : "");
    const webp = bytes(
      "RIFF",
      0,
      0,
      0,
      0,
      "WEBP",
      riff("VP8X", new Uint8Array(10)),
      riff("EXIF", bytes("abc")),
      riff("XMP ", bytes("<x/>")),
    );
    expect(webpBlocks(webp)).toEqual(["EXIF", "XMP"]);
  });
});

it("names the copy after the original", () => {
  expect(outputName("holiday.jpeg", "jpeg")).toBe("holiday-no-metadata.jpg");
  expect(outputName("scan.webp", "webp")).toBe("scan-no-metadata.png");
});
