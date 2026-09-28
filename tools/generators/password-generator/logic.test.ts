import { describe, expect, it } from "vitest";
import {
  CHARACTER_KINDS,
  CHARACTER_SETS,
  entropyBits,
  type Input,
  MAX_LENGTH,
  MIN_LENGTH,
  type RandomSource,
  randomIndex,
  run,
  strengthOf,
} from "./logic";

const ALL: Input = { length: 16, upper: true, lower: true, digits: true, symbols: true };

/** A seeded generator (mulberry32), so a failing test can be run again with the same values. */
function seeded(seed: number): RandomSource {
  let state = seed >>> 0;
  return (array) => {
    for (let index = 0; index < array.length; index++) {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      array[index] = (t ^ (t >>> 14)) >>> 0;
    }
    return array;
  };
}

/** Gives back the values it was given, in order, then repeats them. */
function fixed(values: number[]): RandomSource {
  let next = 0;
  return (array) => {
    for (let index = 0; index < array.length; index++) {
      array[index] = values[next % values.length] ?? 0;
      next++;
    }
    return array;
  };
}

function password(input: Input, random?: RandomSource): string {
  const result = run(input, random);
  if (!result.ok) throw new Error(result.error);
  return result.password;
}

describe("run", () => {
  it("makes a 16-character password from all four kinds by default", () => {
    const result = run(ALL);
    if (!result.ok) throw new Error(result.error);
    expect(result.password).toHaveLength(16);
    for (const kind of CHARACTER_KINDS) {
      expect([...CHARACTER_SETS[kind]].some((char) => result.password.includes(char))).toBe(true);
    }
    expect(result.strength).toBe("very-strong");
  });

  it("uses the operating system's random source, so two passwords differ", () => {
    const seen = new Set(Array.from({ length: 50 }, () => password(ALL)));
    expect(seen.size).toBe(50);
  });

  it("uses only the chosen kinds, and every chosen kind appears", () => {
    const random = seeded(1);
    for (const kinds of [
      { upper: true, lower: false, digits: false, symbols: false },
      { upper: false, lower: false, digits: true, symbols: false },
      { upper: false, lower: true, digits: false, symbols: true },
      { upper: true, lower: false, digits: true, symbols: true },
    ]) {
      const chosen = CHARACTER_KINDS.filter((kind) => kinds[kind]);
      const pool = chosen.map((kind) => CHARACTER_SETS[kind]).join("");
      for (let draw = 0; draw < 200; draw++) {
        const value = password({ length: MIN_LENGTH, ...kinds }, random);
        expect([...value].every((char) => pool.includes(char))).toBe(true);
        for (const kind of chosen) {
          expect([...CHARACTER_SETS[kind]].some((char) => value.includes(char))).toBe(true);
        }
      }
    }
  });

  it("makes passwords of the shortest and the longest length", () => {
    expect(password({ ...ALL, length: MIN_LENGTH })).toHaveLength(8);
    expect(password({ ...ALL, length: MAX_LENGTH })).toHaveLength(128);
  });

  it("refuses a length outside 8 to 128, or not a whole number", () => {
    for (const length of [0, 7, 129, 12.5, Number.NaN]) {
      expect(run({ ...ALL, length })).toEqual({
        ok: false,
        error: "Choose a length from 8 to 128 characters.",
      });
    }
  });

  it("refuses when no kind of character is chosen", () => {
    expect(run({ length: 16, upper: false, lower: false, digits: false, symbols: false })).toEqual({
      ok: false,
      error: "Choose at least one kind of character.",
    });
  });

  it("stops with an error when the random source never gives a usable password", () => {
    // Always 0: always "A", so a password never holds a lowercase letter.
    expect(run({ ...ALL, lower: true }, fixed([0]))).toEqual({
      ok: false,
      error: "The random number source did not work. Reload the page and try again.",
    });
  });

  it("never uses quotes, the backslash, the backtick or a space", () => {
    const pool = Object.values(CHARACTER_SETS).join("");
    for (const code of [0x22, 0x27, 0x5c, 0x60, 0x20]) {
      expect(pool.includes(String.fromCharCode(code))).toBe(false);
    }
    expect(new Set(pool).size).toBe(pool.length);
  });
});

describe("randomIndex", () => {
  it("draws again instead of favouring small results", () => {
    // 2^32 is not a multiple of 90; the values from the last multiple up are rejected.
    const limit = 2 ** 32 - (2 ** 32 % 90);
    expect(randomIndex(90, fixed([limit, limit + 5, 2 ** 32 - 1, 95]))).toBe(5);
  });

  it("gives every index about as often as every other", () => {
    const random = seeded(7);
    const counts = new Array<number>(10).fill(0);
    for (let draw = 0; draw < 100_000; draw++) {
      const index = randomIndex(10, random);
      counts[index] = (counts[index] ?? 0) + 1;
    }
    for (const count of counts) expect(Math.abs(count - 10_000)).toBeLessThan(500);
  });
});

describe("strength", () => {
  it("counts the bits of one kind exactly", () => {
    expect(entropyBits(8, [10])).toBeCloseTo(8 * Math.log2(10), 10);
    expect(entropyBits(20, [26])).toBeCloseTo(20 * Math.log2(26), 10);
  });

  it("subtracts the passwords that miss a chosen kind", () => {
    // Length 2 over {a} and {1}: only "a1" and "1a" hold both, so exactly one bit.
    expect(entropyBits(2, [1, 1])).toBeCloseTo(1, 10);
    // Length 3 over two sets of 2: 4^3 minus the 2^3 strings from each set alone = 48.
    expect(entropyBits(3, [2, 2])).toBeCloseTo(Math.log2(48), 10);
  });

  it("stays finite at the longest length with every kind", () => {
    const bits = entropyBits(MAX_LENGTH, [26, 26, 10, 28]);
    expect(bits).toBeCloseTo(128 * Math.log2(90), 3);
  });

  it("rates the passwords the page describes", () => {
    const rate = (input: Input) => {
      const result = run(input);
      if (!result.ok) throw new Error(result.error);
      return [Math.floor(result.bits), result.strength];
    };
    expect(rate(ALL)).toEqual([103, "very-strong"]);
    expect(rate({ ...ALL, length: 8 })).toEqual([50, "fair"]);
    expect(rate({ length: 8, upper: false, lower: false, digits: true, symbols: false })).toEqual([
      26,
      "weak",
    ]);
    expect(rate({ length: 12, upper: true, lower: true, digits: true, symbols: false })).toEqual([
      71,
      "strong",
    ]);
  });

  it("uses the thresholds 40, 60 and 80 bits", () => {
    expect(strengthOf(39.9)).toBe("weak");
    expect(strengthOf(40)).toBe("fair");
    expect(strengthOf(59.9)).toBe("fair");
    expect(strengthOf(60)).toBe("strong");
    expect(strengthOf(79.9)).toBe("strong");
    expect(strengthOf(80)).toBe("very-strong");
  });
});
