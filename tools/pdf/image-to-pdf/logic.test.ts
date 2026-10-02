import { describe, expect, it } from "vitest";
import {
  checkFiles,
  embedAs,
  imageTypeOf,
  LIMITS,
  layout,
  MESSAGES,
  move,
  outputName,
  POINTS_PER_MM,
  withinPixelLimit,
} from "./logic";

const image = (name: string, size = 1000, type = "image/jpeg") => ({ name, type, size });

describe("layout", () => {
  it("fits a large landscape picture on a landscape A4 page, centred inside the margin", () => {
    const place = layout(1200, 800, { size: "a4", orientation: "auto", margin: "10" });
    expect(place.pageWidth).toBeCloseTo(841.89);
    expect(place.pageHeight).toBeCloseTo(595.28);
    const room = 841.89 - 20 * POINTS_PER_MM;
    expect(place.width).toBeCloseTo(room);
    expect(place.height).toBeCloseTo((room * 800) / 1200);
    expect(place.x).toBeCloseTo(10 * POINTS_PER_MM);
    expect(place.y).toBeCloseTo((595.28 - place.height) / 2);
  });

  it("uses a portrait page for a tall picture, and follows a forced orientation", () => {
    expect(layout(800, 1200, { size: "letter", orientation: "auto", margin: "0" })).toMatchObject({
      pageWidth: 612,
      pageHeight: 792,
    });
    expect(
      layout(1200, 800, { size: "letter", orientation: "portrait", margin: "0" }),
    ).toMatchObject({ pageWidth: 612, pageHeight: 792, width: 612 });
  });

  it("never enlarges a small picture: one pixel is one point", () => {
    const place = layout(200, 100, { size: "a4", orientation: "portrait", margin: "20" });
    expect(place.width).toBe(200);
    expect(place.height).toBe(100);
  });

  it("makes the page the picture plus the margins for Fit to each picture", () => {
    expect(layout(300, 200, { size: "fit", orientation: "auto", margin: "0" })).toEqual({
      pageWidth: 300,
      pageHeight: 200,
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
    const margin = 10 * POINTS_PER_MM;
    expect(layout(300, 200, { size: "fit", orientation: "portrait", margin: "10" })).toMatchObject({
      pageWidth: 300 + margin * 2,
      x: margin,
    });
  });
});

describe("files", () => {
  it("takes JPG, PNG and WebP up to 25 MB, and up to 50 pictures", () => {
    const { accepted, rejected } = checkFiles([
      image("a.jpg"),
      image("b.png", LIMITS.maxInputBytes, "image/png"),
      image("c.webp", LIMITS.maxInputBytes + 1, "image/webp"),
      image("d.gif", 10, "image/gif"),
    ]);
    expect(accepted.map((file) => file.name)).toEqual(["a.jpg", "b.png"]);
    expect(rejected).toEqual([
      { name: "c.webp", reason: MESSAGES.tooLarge("25 MB") },
      { name: "d.gif", reason: MESSAGES.notAnImage },
    ]);
    const full = checkFiles([image("x.jpg"), image("y.jpg")], LIMITS.maxFiles - 1);
    expect(full.accepted).toHaveLength(1);
    expect(full.rejected[0]?.reason).toBe(MESSAGES.tooManyFiles(50));
  });

  it("knows the type by extension when the browser gave none, and how to embed it", () => {
    expect(imageTypeOf({ name: "scan.JPEG", type: "" })).toBe("image/jpeg");
    expect(embedAs("image/jpeg")).toBe("jpg");
    expect(embedAs("image/png")).toBe("png");
    expect(embedAs("image/webp")).toBe("png");
    expect(withinPixelLimit(10_000, 5_001)).toBe(false);
  });

  it("moves pictures and names the PDF after the first", () => {
    expect(move(["a", "b"], 1, -1)).toEqual(["b", "a"]);
    expect(move(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(outputName("holiday.jpg")).toBe("holiday.pdf");
    expect(outputName(undefined)).toBe("images.pdf");
  });
});
