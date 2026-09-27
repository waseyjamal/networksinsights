import { describe, expect, it } from "vitest";
import {
  checkFiles,
  defaultFormat,
  formatSize,
  inputTypeOf,
  LIMITS,
  MAX_PIXELS,
  MESSAGES,
  OUTPUT_FORMATS,
  outputName,
  QUALITY_LEVELS,
  saving,
  sizeLine,
  withinPixelLimit,
  writableFormats,
} from "./logic";
import manifest from "./tool.config";

const file = (name: string, type: string, size = 1000) => ({ name, type, size });

describe("the limits", () => {
  it("are the ones the manifest declares, so the page and Quick facts agree", () => {
    expect(manifest.limits).toEqual({ maxInputBytes: 25 * 1024 * 1024, maxFiles: 20 });
    expect(LIMITS).toEqual(manifest.limits);
  });

  it("match what the manifest says the tool accepts and produces", () => {
    expect(manifest.accepts).toEqual(["JPG", "PNG", "WebP"]);
    expect(manifest.produces).toEqual(Object.values(OUTPUT_FORMATS).map((format) => format.label));
  });
});

describe("inputTypeOf", () => {
  it("takes the three image types by their media type", () => {
    expect(inputTypeOf(file("a.jpg", "image/jpeg"))).toBe("image/jpeg");
    expect(inputTypeOf(file("a.png", "image/png"))).toBe("image/png");
    expect(inputTypeOf(file("a.webp", "image/webp"))).toBe("image/webp");
  });

  it("falls back to the extension only when the browser gave no media type", () => {
    expect(inputTypeOf(file("scan.JPEG", ""))).toBe("image/jpeg");
    expect(inputTypeOf(file("scan.webp", ""))).toBe("image/webp");
    expect(inputTypeOf(file("notes.txt", ""))).toBeUndefined();
    // A media type that says otherwise wins over the name.
    expect(inputTypeOf(file("fake.png", "text/html"))).toBeUndefined();
  });

  it("refuses other image types", () => {
    expect(inputTypeOf(file("a.gif", "image/gif"))).toBeUndefined();
    expect(inputTypeOf(file("a.svg", "image/svg+xml"))).toBeUndefined();
    expect(inputTypeOf(file("a.heic", "image/heic"))).toBeUndefined();
  });
});

describe("checkFiles", () => {
  it("accepts images within the limits, in their order", () => {
    const files = [file("a.jpg", "image/jpeg"), file("b.png", "image/png")];
    expect(checkFiles(files)).toEqual({ accepted: files, rejected: [] });
  });

  it("refuses a file that is not an image, or too large, with the reason", () => {
    const { accepted, rejected } = checkFiles([
      file("notes.txt", "text/plain"),
      file("huge.png", "image/png", LIMITS.maxInputBytes + 1),
      file("edge.png", "image/png", LIMITS.maxInputBytes),
    ]);
    expect(accepted.map((entry) => entry.name)).toEqual(["edge.png"]);
    expect(rejected).toEqual([
      { name: "notes.txt", reason: MESSAGES.notAnImage },
      { name: "huge.png", reason: "This file is larger than 25 MB." },
    ]);
  });

  it("never lets the list pass the file limit, counting the files already in it", () => {
    const files = Array.from({ length: 5 }, (_, i) => file(`${i}.jpg`, "image/jpeg"));
    const { accepted, rejected } = checkFiles(files, LIMITS.maxFiles - 2);
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(3);
    expect(rejected[0]?.reason).toBe(`Only ${LIMITS.maxFiles} files can be compressed at once.`);
  });
});

describe("outputName", () => {
  it("adds -compressed and the new extension", () => {
    expect(outputName("holiday photo.png", "webp")).toBe("holiday photo-compressed.webp");
    expect(outputName("IMG_0001.JPEG", "jpg")).toBe("IMG_0001-compressed.jpg");
    expect(outputName("no-extension", "jpg")).toBe("no-extension-compressed.jpg");
  });

  it("makes a hostile name safe", () => {
    expect(outputName("../../etc/passwd.png", "jpg")).toBe("-..-etc-passwd-compressed.jpg");
    expect(outputName("photo‮gnp.exe.png", "webp")).toBe("photognp.exe-compressed.webp");
  });
});

describe("sizes and savings", () => {
  it("formats sizes in steps of 1,024", () => {
    expect(formatSize(0)).toBe("0 bytes");
    expect(formatSize(1)).toBe("1 byte");
    expect(formatSize(1023)).toBe("1023 bytes");
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(626_688)).toBe("612 KB");
    expect(formatSize(2.4 * 1024 * 1024)).toBe("2.4 MB");
    expect(formatSize(LIMITS.maxInputBytes)).toBe("25 MB");
  });

  it("computes the saving, and says when the result is larger", () => {
    expect(saving(1000, 250)).toEqual({
      before: 1000,
      after: 250,
      saved: 750,
      percent: 75,
      larger: false,
    });
    expect(saving(1000, 1200)).toMatchObject({ saved: -200, percent: -20, larger: true });
    expect(saving(0, 0)).toMatchObject({ percent: 0, larger: false });
    expect(saving(3, 2).percent).toBe(33);
  });

  it("writes the size line", () => {
    expect(sizeLine(2.4 * 1024 * 1024, 626_688)).toBe("2.4 MB → 612 KB");
  });
});

describe("the encoder settings", () => {
  it("offers three quality levels, each a valid encoder quality", () => {
    const values = Object.values(QUALITY_LEVELS).map((level) => level.value);
    expect(values).toEqual([0.9, 0.75, 0.6]);
    for (const value of values) expect(value).toBeGreaterThan(0);
  });

  it("keeps only the formats the encoder really wrote", () => {
    expect(writableFormats({ jpg: "image/jpeg", webp: "image/webp" })).toEqual(["jpg", "webp"]);
    // Safari has no WebP encoder: it hands back PNG.
    expect(writableFormats({ jpg: "image/jpeg", webp: "image/png" })).toEqual(["jpg"]);
  });

  it("offers WebP first where it can be written, else JPG", () => {
    expect(defaultFormat(["jpg", "webp"])).toBe("webp");
    expect(defaultFormat(["jpg"])).toBe("jpg");
  });

  it("refuses an image with no pixels or more than the pixel limit", () => {
    expect(withinPixelLimit(8000, 6000)).toBe(true);
    expect(withinPixelLimit(10_000, 10_000)).toBe(false);
    expect(withinPixelLimit(MAX_PIXELS, 1)).toBe(true);
    expect(withinPixelLimit(0, 100)).toBe(false);
  });
});
