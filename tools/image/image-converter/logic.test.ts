import { describe, expect, it } from "vitest";
import {
  checkFiles,
  defaultFormat,
  formatSize,
  inputTypeOf,
  LIMITS,
  MESSAGES,
  needsBackground,
  outputName,
  qualityFor,
  withinPixelLimit,
  writableFormats,
} from "./logic";

const file = (name: string, type: string, size = 1000) => ({ name, type, size });

describe("inputTypeOf", () => {
  it("reads the media type, or the extension when the browser gave none", () => {
    expect(inputTypeOf(file("a.png", "image/png"))).toBe("image/png");
    expect(inputTypeOf(file("a.JPEG", ""))).toBe("image/jpeg");
    expect(inputTypeOf(file("a.webp", ""))).toBe("image/webp");
    expect(inputTypeOf(file("a.gif", "image/gif"))).toBeUndefined();
    expect(inputTypeOf(file("a.png", "text/plain"))).toBeUndefined();
    expect(inputTypeOf(file("noextension", ""))).toBeUndefined();
  });
});

describe("checkFiles", () => {
  it("refuses other types, files over the limit, and files past the count", () => {
    const { accepted, rejected } = checkFiles([
      file("ok.png", "image/png"),
      file("edge.png", "image/png", LIMITS.maxInputBytes),
      file("big.png", "image/png", LIMITS.maxInputBytes + 1),
      file("doc.pdf", "application/pdf"),
    ]);
    expect(accepted.map((entry) => entry.name)).toEqual(["ok.png", "edge.png"]);
    expect(rejected).toEqual([
      { name: "big.png", reason: MESSAGES.tooLarge("25 MB") },
      { name: "doc.pdf", reason: MESSAGES.notAnImage },
    ]);
  });

  it("never passes the file limit, counting files already in the list", () => {
    const many = Array.from({ length: 5 }, (_, i) => file(`${i}.jpg`, "image/jpeg"));
    const { accepted, rejected } = checkFiles(many, LIMITS.maxFiles - 2);
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(3);
    expect(rejected[0]?.reason).toBe(MESSAGES.tooManyFiles(LIMITS.maxFiles));
  });

  it("takes an empty list", () => {
    expect(checkFiles([])).toEqual({ accepted: [], rejected: [] });
  });
});

describe("outputName", () => {
  it("swaps the extension for the new format", () => {
    expect(outputName("holiday photo.png", "jpg")).toBe("holiday photo.jpg");
    expect(outputName("scan.JPEG", "webp")).toBe("scan.webp");
    expect(outputName("logo.webp", "png")).toBe("logo.png");
    expect(outputName("no-extension", "png")).toBe("no-extension.png");
    expect(outputName(".png", "jpg")).toBe("image.jpg");
  });
});

describe("formats", () => {
  it("knows which formats a browser writes from what its encoder produced", () => {
    expect(writableFormats({ jpg: "image/jpeg", png: "image/png", webp: "image/webp" })).toEqual([
      "jpg",
      "png",
      "webp",
    ]);
    // Safari: asked for WebP, it writes PNG.
    expect(writableFormats({ jpg: "image/jpeg", png: "image/png", webp: "image/png" })).toEqual([
      "jpg",
      "png",
    ]);
  });

  it("offers JPG first, else what is left", () => {
    expect(defaultFormat(["jpg", "png", "webp"])).toBe("jpg");
    expect(defaultFormat(["png"])).toBe("png");
    expect(defaultFormat([])).toBe("png");
  });

  it("gives JPG a white background and PNG no quality", () => {
    expect(needsBackground("jpg")).toBe(true);
    expect(needsBackground("png")).toBe(false);
    expect(needsBackground("webp")).toBe(false);
    expect(qualityFor("png")).toBeUndefined();
    expect(qualityFor("jpg")).toBe(0.92);
    expect(qualityFor("webp")).toBe(0.92);
  });
});

describe("limits", () => {
  it("holds the pixel limit at 50 megapixels", () => {
    expect(withinPixelLimit(10_000, 5_000)).toBe(true);
    expect(withinPixelLimit(10_000, 5_001)).toBe(false);
    expect(withinPixelLimit(0, 10)).toBe(false);
  });

  it("formats sizes", () => {
    expect(formatSize(1)).toBe("1 byte");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(LIMITS.maxInputBytes)).toBe("25 MB");
  });
});
