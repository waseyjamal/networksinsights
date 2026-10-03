import { describe, expect, it } from "vitest";
import { DEFAULT_LAYER, GLASS_LAYERS, hexToRgb, type Layer, MAX_LAYERS, run } from "./logic";

describe("run", () => {
  it("writes the default layer as the page shows it", () => {
    expect(run({ layers: [DEFAULT_LAYER], glass: false })).toEqual({
      ok: true,
      shadow: "0px 4px 12px 0px rgba(0, 0, 0, 0.25)",
      css: "box-shadow: 0px 4px 12px 0px rgba(0, 0, 0, 0.25);",
    });
  });

  it("joins layers in order and writes inset first", () => {
    const result = run({
      layers: [DEFAULT_LAYER, { ...DEFAULT_LAYER, inset: true, color: "#f80", opacity: 50 }],
      glass: false,
    });
    expect(result.ok && result.shadow).toBe(
      "0px 4px 12px 0px rgba(0, 0, 0, 0.25), inset 0px 4px 12px 0px rgba(255, 136, 0, 0.5)",
    );
  });

  it("adds the backdrop-filter lines for the glass card", () => {
    const result = run({ layers: GLASS_LAYERS, glass: true });
    expect(result.ok && result.css).toBe(
      [
        "box-shadow: 0px 8px 32px 0px rgba(0, 0, 0, 0.2), inset 0px 1px 0px 0px rgba(255, 255, 255, 0.4);",
        "background-color: rgba(255, 255, 255, 0.15);",
        "backdrop-filter: blur(12px);",
        "-webkit-backdrop-filter: blur(12px);",
        "border: 1px solid rgba(255, 255, 255, 0.3);",
      ].join("\n"),
    );
  });

  it("takes exactly five layers and refuses six or none", () => {
    const layers = (n: number): Layer[] => Array.from({ length: n }, () => DEFAULT_LAYER);
    expect(run({ layers: layers(MAX_LAYERS), glass: false }).ok).toBe(true);
    expect(run({ layers: layers(6), glass: false })).toEqual({
      ok: false,
      error: "A shadow here has 1 to 5 layers; this has 6.",
    });
    expect(run({ layers: [], glass: false }).ok).toBe(false);
  });

  it("takes every range at its edges and refuses one over", () => {
    const at = { ...DEFAULT_LAYER, x: -100, y: 100, blur: 100, spread: -50, opacity: 100 };
    expect(run({ layers: [at], glass: false }).ok).toBe(true);
    expect(run({ layers: [{ ...at, x: 101 }], glass: false })).toEqual({
      ok: false,
      error: "Layer 1: Horizontal offset must be from -100 to 100.",
    });
    expect(run({ layers: [{ ...at, blur: -1 }], glass: false }).ok).toBe(false);
    expect(run({ layers: [{ ...at, spread: 51 }], glass: false }).ok).toBe(false);
    expect(run({ layers: [{ ...at, opacity: 101 }], glass: false }).ok).toBe(false);
    expect(run({ layers: [{ ...at, y: Number.NaN }], glass: false }).ok).toBe(false);
  });

  it("refuses a colour that is not HEX", () => {
    expect(run({ layers: [{ ...DEFAULT_LAYER, color: "black" }], glass: false })).toEqual({
      ok: false,
      error: "Layer 1: use a HEX colour with 3 or 6 digits, such as #000000.",
    });
  });
});

describe("hexToRgb", () => {
  it("reads 3 and 6 digit codes", () => {
    expect(hexToRgb("#f80")).toEqual({ r: 255, g: 136, b: 0 });
    expect(hexToRgb("3B82F6")).toEqual({ r: 59, g: 130, b: 246 });
    expect(hexToRgb("#3b82f680")).toBeNull();
  });
});
