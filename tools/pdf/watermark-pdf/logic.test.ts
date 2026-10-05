import { describe, expect, it } from "vitest";
import {
  CAP_HEIGHT,
  centres,
  checkFile,
  checkText,
  isDrawable,
  LIMITS,
  MAX_TEXT,
  MAX_TILES,
  MESSAGES,
  outputName,
  type PageBox,
  parseColor,
  parseInteger,
  placeCopy,
  placements,
  planWatermark,
  type Settings,
  undrawable,
} from "./logic";

const base: Settings = {
  text: "DRAFT",
  fontSize: "60",
  color: "#808080",
  opacity: "25",
  angle: "45",
  layout: "single",
  which: "all",
  pages: "",
};

const plan = (settings: Partial<Settings>, pages = 3) => {
  const planned = planWatermark({ ...base, ...settings }, pages);
  return planned.ok ? planned.plan : planned.error;
};

describe("the standard font's characters", () => {
  it("draws Latin letters, digits, Latin-1 accents and the WinAnsi extras", () => {
    for (const character of ["A", "z", "7", "!", "~", "é", "ß", "ÿ", "€", "—", "“", "™"]) {
      expect(isDrawable(character)).toBe(true);
    }
  });

  it("cannot draw other scripts, emoji or Latin Extended letters", () => {
    for (const character of ["ह", "₹", "😀", "Ā", "ł", "Ж", "中", "\n"]) {
      expect(isDrawable(character)).toBe(false);
    }
    expect(undrawable("नमस्ते ok ₹₹")).toEqual(["न", "म", "स", "्", "त", "े", "₹"]);
  });

  it("refuses text the font cannot draw, naming up to five characters", () => {
    expect(checkText("Price ₹100")).toEqual({
      ok: false,
      error: MESSAGES.unsupported('"₹"'),
    });
    expect(MESSAGES.unsupported('"₹"')).toBe(
      'The standard PDF font cannot draw "₹". Use Latin letters, digits and common punctuation.',
    );
    expect(checkText("नमस्ते").ok).toBe(false);
  });

  it("takes 1 to 100 characters, counted as characters", () => {
    expect(checkText("  DRAFT  ")).toEqual({ ok: true, text: "DRAFT" });
    expect(checkText("   ")).toEqual({ ok: false, error: MESSAGES.noText });
    expect(checkText("x".repeat(MAX_TEXT))).toEqual({ ok: true, text: "x".repeat(100) });
    expect(checkText("x".repeat(MAX_TEXT + 1))).toEqual({ ok: false, error: MESSAGES.longText });
    expect(checkText("é".repeat(100)).ok).toBe(true);
  });
});

describe("planWatermark", () => {
  it("turns the settings into a plan", () => {
    expect(plan({})).toEqual({
      text: "DRAFT",
      fontSize: 60,
      rgb: [128 / 255, 128 / 255, 128 / 255],
      opacity: 0.25,
      angle: 45,
      layout: "single",
      pages: [1, 2, 3],
    });
    expect(plan({ which: "chosen", pages: "3, 1" })).toMatchObject({ pages: [1, 3] });
  });

  it("checks every number at its limits", () => {
    expect(plan({ fontSize: "8" })).toMatchObject({ fontSize: 8 });
    expect(plan({ fontSize: "200" })).toMatchObject({ fontSize: 200 });
    expect(plan({ fontSize: "7" })).toBe(MESSAGES.fontSize);
    expect(plan({ fontSize: "201" })).toBe(MESSAGES.fontSize);
    expect(plan({ opacity: "5" })).toMatchObject({ opacity: 0.05 });
    expect(plan({ opacity: "100" })).toMatchObject({ opacity: 1 });
    expect(plan({ opacity: "4" })).toBe(MESSAGES.opacity);
    expect(plan({ opacity: "101" })).toBe(MESSAGES.opacity);
    expect(plan({ angle: "-180" })).toMatchObject({ angle: -180 });
    expect(plan({ angle: "180" })).toMatchObject({ angle: 180 });
    expect(plan({ angle: "181" })).toBe(MESSAGES.angle);
    expect(plan({ angle: "-181" })).toBe(MESSAGES.angle);
    expect(plan({ color: "grey" })).toBe(MESSAGES.color);
    expect(plan({ which: "chosen", pages: "4" })).toBe(MESSAGES.outside(4, 3));
  });
});

describe("numbers and colours", () => {
  it("reads colours", () => {
    expect(parseColor("#ff0000")).toEqual([1, 0, 0]);
    expect(parseColor("00f")).toEqual([0, 0, 1]);
    expect(parseColor("#12345")).toBeUndefined();
  });

  it("reads whole numbers, negative too", () => {
    expect(parseInteger("-45")).toBe(-45);
    expect(parseInteger("−45")).toBe(-45);
    expect(parseInteger("4.5")).toBeUndefined();
    expect(parseInteger("")).toBeUndefined();
  });
});

describe("placement", () => {
  const box: PageBox = { x: 0, y: 0, width: 300, height: 400, rotation: 0 };

  it("centres one level copy on the page", () => {
    const place = placeCopy(box, 150, 200, 0, 100, 20);
    expect(place.x).toBeCloseTo(100);
    expect(place.y).toBeCloseTo(200 - (20 * CAP_HEIGHT) / 2);
    expect(place.rotate).toBe(0);
  });

  it("keeps the centre of a turned copy in place", () => {
    const place = placeCopy(box, 150, 200, 90, 100, 20);
    // Turned a quarter turn, the text runs upwards: it starts 50 below the centre.
    expect(place.x).toBeCloseTo(150 + (20 * CAP_HEIGHT) / 2);
    expect(place.y).toBeCloseTo(150);
    expect(place.rotate).toBe(90);
    expect(placeCopy(box, 150, 200, -45, 100, 20).rotate).toBe(315);
  });

  it("adds the page's own turn so the copy reads at the angle as seen", () => {
    const turned = { ...box, rotation: 90 };
    const [place] = placements(turned, "single", 0, 100, 20);
    // Seen 400 wide and 300 high; the centre (200, 150) maps to the page's (150, 200).
    expect(place?.rotate).toBe(90);
    expect((place?.x ?? 0) - (20 * CAP_HEIGHT) / 2).toBeCloseTo(150);
    expect((place?.y ?? 0) + 50).toBeCloseTo(200);
  });

  it("tiles copies over the whole page, and caps their number", () => {
    const single = placements(box, "single", 45, 100, 20);
    expect(single).toHaveLength(1);
    const tiled = placements(box, "tiled", 45, 100, 20);
    expect(tiled.length).toBeGreaterThan(10);
    expect(tiled.length).toBeLessThanOrEqual(MAX_TILES);
    const tiny = placements({ ...box, width: 3000, height: 3000 }, "tiled", 0, 10, 8);
    expect(tiny.length).toBeLessThanOrEqual(MAX_TILES);
    expect(tiny.length).toBeGreaterThan(MAX_TILES / 2);
    // Spread over the whole page, not cut off part way.
    expect(Math.max(...tiny.map((place) => place.y))).toBeGreaterThan(2900);
    expect(Math.min(...tiny.map((place) => place.y))).toBeLessThan(100);
    expect(centres("single", 300, 400, 10, 10)).toEqual([[150, 200]]);
  });
});

describe("files", () => {
  it("checks the type and the 50 MB limit", () => {
    expect(checkFile({ name: "a.pdf", type: "", size: LIMITS.maxInputBytes })).toBeUndefined();
    expect(checkFile({ name: "a.pdf", type: "", size: LIMITS.maxInputBytes + 1 })).toBe(
      MESSAGES.tooLarge("50 MB"),
    );
    expect(checkFile({ name: "a.doc", type: "application/msword", size: 1 })).toBe(
      MESSAGES.notAPdf,
    );
  });

  it("names the result", () => {
    expect(outputName("contract.PDF")).toBe("contract-watermarked.pdf");
  });
});
