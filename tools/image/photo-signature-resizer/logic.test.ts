import { describe, expect, it } from "vitest";
import {
  checkFile,
  checkSettings,
  findQuality,
  formatKb,
  LIMITS,
  MAX_SIDE,
  MESSAGES,
  outputName,
  placement,
  QUALITY_MAX,
  QUALITY_MIN,
  targetBytes,
} from "./logic";

/** A fake encoder: the file grows with the quality, as a JPG does. */
const encoder = (bytesAt: (quality: number) => number) => {
  const tried: number[] = [];
  const encode = async (quality: number) => {
    tried.push(quality);
    return { size: Math.round(bytesAt(quality)), quality };
  };
  return { encode, tried };
};

describe("findQuality", () => {
  it("keeps the best quality when it already fits", async () => {
    const { encode, tried } = encoder(() => 1000);
    const found = await findQuality(encode, 5000);
    expect(found).toMatchObject({ met: true, quality: QUALITY_MAX });
    expect(tried).toEqual([QUALITY_MAX]);
  });

  it("finds the largest quality under the limit", async () => {
    // 10,000 bytes at quality 0, 110,000 at quality 1.
    const { encode } = encoder((quality) => 10_000 + quality * 100_000);
    const found = await findQuality(encode, 50_000);
    if (!found.met) throw new Error("expected a file");
    expect(found.file.size).toBeLessThanOrEqual(50_000);
    expect(found.quality).toBeGreaterThan(0.39);
    expect(found.quality).toBeLessThanOrEqual(0.4);
  });

  it("says honestly when even the smallest quality is too big", async () => {
    const { encode, tried } = encoder((quality) => 80_000 + quality * 10_000);
    const found = await findQuality(encode, 20_000);
    expect(found.met).toBe(false);
    if (found.met) throw new Error("expected no file");
    expect(found.smallest.size).toBe(80_500);
    expect(tried).toEqual([QUALITY_MAX, QUALITY_MIN]);
  });

  it("reports each step", async () => {
    const steps: number[] = [];
    const { encode } = encoder((quality) => quality * 100_000);
    await findQuality(encode, 30_000, (done) => steps.push(done));
    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("settings", () => {
  it("takes whole pixels from 1 to 4000 and KB from 1 to 5000", () => {
    expect(checkSettings({ width: 200, height: 230, maxKb: 50 })).toBeUndefined();
    expect(checkSettings({ width: MAX_SIDE, height: 1, maxKb: 5000 })).toBeUndefined();
    expect(checkSettings({ width: MAX_SIDE + 1, height: 1, maxKb: 5 })).toBe(MESSAGES.side);
    expect(checkSettings({ width: 0, height: 1, maxKb: 5 })).toBe(MESSAGES.side);
    expect(checkSettings({ width: 10.5, height: 1, maxKb: 5 })).toBe(MESSAGES.side);
    expect(checkSettings({ height: 1, maxKb: 5 })).toBe(MESSAGES.side);
    expect(checkSettings({ width: 1, height: 1, maxKb: 0 })).toBe(MESSAGES.kb);
    expect(checkSettings({ width: 1, height: 1, maxKb: 5001 })).toBe(MESSAGES.kb);
    expect(checkSettings({ width: 1, height: 1 })).toBe(MESSAGES.kb);
  });

  it("counts a KB as 1,000 bytes, so the file is under the limit either way", () => {
    expect(targetBytes(20)).toBe(20_000);
    expect(formatKb(18_431)).toBe("18.4 KB (18,431 bytes)");
  });

  it("checks the file type and the 25 MB limit", () => {
    expect(checkFile({ name: "a.png", type: "image/png", size: LIMITS.maxInputBytes })).toBe(
      undefined,
    );
    expect(checkFile({ name: "a.png", type: "image/png", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooLarge("25 MB"),
    );
    expect(checkFile({ name: "a.heic", type: "image/heic", size: 1 })).toBe(MESSAGES.notAnImage);
  });
});

describe("placement", () => {
  const wide = { width: 1200, height: 800 };
  const tall = { width: 200, height: 230 };

  it("crops a wide picture to a tall frame, centred", () => {
    const at = placement(wide, tall, "crop");
    expect(at.sh).toBe(800);
    expect(at.sw).toBeCloseTo((800 * 200) / 230);
    expect(at.sx).toBeCloseTo((1200 - at.sw) / 2);
    expect([at.dx, at.dy, at.dw, at.dh]).toEqual([0, 0, 200, 230]);
  });

  it("fits a wide picture inside a tall frame with bands above and below", () => {
    const at = placement(wide, tall, "pad");
    expect(at.dw).toBe(200);
    expect(at.dh).toBeCloseTo(133.33, 1);
    expect(at.dy).toBeCloseTo((230 - at.dh) / 2);
    expect([at.sx, at.sy, at.sw, at.sh]).toEqual([0, 0, 1200, 800]);
  });

  it("names the result after the size, as JPG", () => {
    expect(outputName("passport.png", 200, 230)).toBe("passport-200x230.jpg");
    expect(outputName(".png", 1, 1)).toBe("photo-1x1.jpg");
  });
});
