import { describe, expect, it } from "vitest";
import { type Input, normalizeHex, run, spread } from "./logic";

const A = { color: "#3b82f6", position: 0 };
const B = { color: "#f80", position: 100 };
const base: Input = {
  kind: "linear",
  angle: 90,
  shape: "circle",
  stops: [A, B],
};

describe("run", () => {
  it("writes the linear example of the page", () => {
    expect(run(base)).toEqual({
      ok: true,
      value: "linear-gradient(90deg, #3b82f6 0%, #ff8800 100%)",
      css: "background-image: linear-gradient(90deg, #3b82f6 0%, #ff8800 100%);",
    });
  });

  it("writes radial and conic gradients", () => {
    const radial = run({ ...base, kind: "radial", shape: "ellipse" });
    expect(radial.ok && radial.value).toBe("radial-gradient(ellipse, #3b82f6 0%, #ff8800 100%)");
    const conic = run({ ...base, kind: "conic", angle: 45 });
    expect(conic.ok && conic.value).toBe("conic-gradient(from 45deg, #3b82f6 0%, #ff8800 100%)");
  });

  it("takes exactly 2 and exactly 6 stops, and refuses 1 and 7", () => {
    const stops = (n: number) => spread(Array.from({ length: n }, () => "#000"));
    expect(run({ ...base, stops: stops(2) }).ok).toBe(true);
    expect(run({ ...base, stops: stops(6) }).ok).toBe(true);
    expect(run({ ...base, stops: stops(1) })).toEqual({
      ok: false,
      error: "A gradient here has 2 to 6 colour stops; this has 1.",
    });
    expect(run({ ...base, stops: stops(7) }).ok).toBe(false);
  });

  it("takes angles 0 and 360 and refuses one over, a negative or not a number", () => {
    expect(run({ ...base, angle: 0 }).ok).toBe(true);
    expect(run({ ...base, angle: 360 }).ok).toBe(true);
    expect(run({ ...base, angle: 361 }).ok).toBe(false);
    expect(run({ ...base, angle: -1 }).ok).toBe(false);
    expect(run({ ...base, angle: Number.NaN }).ok).toBe(false);
  });

  it("refuses a position over 100 and a colour with alpha, naming the stop", () => {
    expect(run({ ...base, stops: [A, { color: "#000", position: 101 }] })).toEqual({
      ok: false,
      error: "Stop 2: the position must be from 0 to 100%.",
    });
    expect(run({ ...base, stops: [{ color: "#3b82f680", position: 0 }, B] })).toEqual({
      ok: false,
      error: "Stop 1: use a HEX colour with 3 or 6 digits, such as #3b82f6.",
    });
  });
});

describe("normalizeHex", () => {
  it("expands short codes, lowercases and needs no #", () => {
    expect(normalizeHex("#F80")).toBe("#ff8800");
    expect(normalizeHex("ABCDEF")).toBe("#abcdef");
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
  });
});

describe("spread", () => {
  it("spaces stops evenly from 0 to 100", () => {
    expect(spread(["#000", "#111", "#222"]).map((stop) => stop.position)).toEqual([0, 50, 100]);
  });
});
