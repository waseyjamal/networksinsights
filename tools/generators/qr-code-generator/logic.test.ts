import { describe, expect, it } from "vitest";
import {
  alignmentPositions,
  capacity,
  codewords,
  dataCodewords,
  encode,
  errorCorrection,
  formatBits,
  generatorPolynomial,
  LEVELS,
  MAX_SIZE,
  MESSAGES,
  MIN_MODULE_PX,
  MIN_SIZE,
  modeOf,
  modulesOf,
  place,
  QUIET_ZONE,
  run,
  SIZES,
  smallestSizeFor,
  versionBits,
} from "./logic";

// The encoder was checked against two independent programs while it was written: segno drew the
// same modules for every numeric and alphanumeric code, mask by mask, and the zxing-cpp reader read
// back every code below, UTF-8 text included, at the level it was made with. The fixtures here keep
// that result: a change that breaks the encoder breaks one of them.

/** "HELLO WORLD" at level Q, version 1, mask 6: `#` is a dark module. */
const HELLO_WORLD_Q = [
  "#######....#..#######",
  "#.....#.##..#.#.....#",
  "#.###.#..#.##.#.###.#",
  "#.###.#.#####.#.###.#",
  "#.###.#.##.#..#.###.#",
  "#.....#..#..#.#.....#",
  "#######.#.#.#.#######",
  "........##.##........",
  ".#.####.##..###.##.#.",
  "#.####.#....####.###.",
  "..#.#.##...#..##.....",
  "#.##.#...#.##...##...",
  "##.########.###.#####",
  "........#...#..#.#...",
  "#######..##..##..####",
  "#.....#.#.#..#..#.###",
  "#.###.#.##.#..#...###",
  "#.###.#.#.###...#.#..",
  "#.###.#..#....#....##",
  "#.....#.###..###..##.",
  "#######..#.#.......#.",
];

function rows(text: string, level: (typeof LEVELS)[number], mask?: number): string[] {
  const code = encode(text, level, mask);
  if (!code) throw new Error("no code");
  const result: string[] = [];
  for (let y = 0; y < code.modules; y++)
    result.push(
      Array.from(code.dark.slice(y * code.modules, (y + 1) * code.modules))
        .map((value) => (value === 1 ? "#" : "."))
        .join(""),
    );
  return result;
}

/** The dark modules of the three finder patterns, which every code must have in place. */
function hasFinders(lines: string[]): boolean {
  const size = lines.length;
  const finder = ["#######", "#.....#", "#.###.#", "#.###.#", "#.###.#", "#.....#", "#######"];
  const at = (x: number, y: number) =>
    finder.every((line, dy) => lines[y + dy]?.slice(x, x + 7) === line);
  return at(0, 0) && at(size - 7, 0) && at(0, size - 7);
}

describe("encode", () => {
  it("draws HELLO WORLD at level Q exactly as the reference does", () => {
    expect(rows("HELLO WORLD", "Q")).toEqual(HELLO_WORLD_Q);
    expect(encode("HELLO WORLD", "Q")).toMatchObject({ version: 1, mode: "alphanumeric", mask: 6 });
  });

  it("chooses the smallest mode that holds the whole text", () => {
    expect(modeOf("0123456789")).toBe("numeric");
    expect(modeOf("HELLO WORLD $%*+-./:")).toBe("alphanumeric");
    expect(modeOf("Hello")).toBe("byte");
    expect(modeOf("https://example.com/")).toBe("byte");
    expect(modeOf("日本語")).toBe("byte");
  });

  it("chooses the smallest version that fits, and a larger one for a higher level", () => {
    // Version 1 holds 17 bytes at L and 14 at M (ISO/IEC 18004, table 7).
    expect(encode("a".repeat(17), "L")?.version).toBe(1);
    expect(encode("a".repeat(18), "L")?.version).toBe(2);
    expect(encode("a".repeat(14), "M")?.version).toBe(1);
    expect(encode("a".repeat(15), "M")?.version).toBe(2);
    const url = "https://networksinsights.com/qr-code-generator/";
    const versions = LEVELS.map((level) => encode(url, level)?.version ?? 0);
    expect(versions).toEqual([3, 4, 5, 6]);
  });

  it("counts UTF-8 bytes, not characters", () => {
    // Seven characters, 21 bytes: too many for version 1 at level L.
    expect(encode("日本語のテキスト".slice(0, 7), "L")?.version).toBe(2);
  });

  it("uses the mask it is given, and draws finders, timing and the dark module for every mask", () => {
    for (let mask = 0; mask < 8; mask++) {
      const code = encode("QR", "M", mask);
      expect(code?.mask).toBe(mask);
      const lines = rows("QR", "M", mask);
      expect(hasFinders(lines)).toBe(true);
      // The timing pattern alternates along row 6 and column 6.
      expect(lines[6]?.slice(8, 13)).toBe("#.#.#");
      expect(
        lines
          .slice(8, 13)
          .map((line) => line[6])
          .join(""),
      ).toBe("#.#.#");
      // The dark module above the bottom-left finder.
      expect(lines[lines.length - 8]?.[8]).toBe("#");
    }
  });

  it("holds the largest text at version 40 and refuses one character more", () => {
    for (const level of LEVELS) {
      const most = capacity("byte", level);
      expect(encode("a".repeat(most), level)?.version).toBe(40);
      expect(encode("a".repeat(most + 1), level)).toBeNull();
    }
    const allNumeric = capacity("numeric", "L");
    expect(encode("7".repeat(allNumeric), "L")?.modules).toBe(177);
    expect(encode("7".repeat(allNumeric + 1), "L")).toBeNull();
  });

  it("refuses a huge paste straight away", () => {
    expect(encode("x".repeat(1_000_000), "L")).toBeNull();
  });
});

describe("the standard's tables", () => {
  it("gives the capacities of version 40 (ISO/IEC 18004, table 7)", () => {
    expect(LEVELS.map((level) => capacity("byte", level))).toEqual([2953, 2331, 1663, 1273]);
    expect(LEVELS.map((level) => capacity("alphanumeric", level))).toEqual([
      4296, 3391, 2420, 1852,
    ]);
    expect(LEVELS.map((level) => capacity("numeric", level))).toEqual([7089, 5596, 3993, 3057]);
  });

  it("gives the data codewords of a few versions", () => {
    expect(LEVELS.map((level) => dataCodewords(1, level))).toEqual([19, 16, 13, 9]);
    expect(LEVELS.map((level) => dataCodewords(10, level))).toEqual([274, 216, 154, 122]);
    expect(LEVELS.map((level) => dataCodewords(40, level))).toEqual([2956, 2334, 1666, 1276]);
  });

  it("places the alignment patterns", () => {
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(2)).toEqual([6, 18]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
    expect(modulesOf(40)).toBe(177);
  });

  it("computes the format and version bits", () => {
    // Level M with mask 0, and level L with mask 4 (ISO/IEC 18004, annex C).
    expect(formatBits("M", 0).toString(2).padStart(15, "0")).toBe("101010000010010");
    expect(formatBits("L", 4).toString(2).padStart(15, "0")).toBe("110011000101111");
    expect(versionBits(7).toString(2).padStart(18, "0")).toBe("000111110010010100");
  });

  it("computes the Reed-Solomon bytes of HELLO WORLD at 1-Q", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236];
    expect(errorCorrection(data, generatorPolynomial(13))).toEqual([
      168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16,
    ]);
    // One block: the data, then its error correction.
    expect(codewords(data, 1, "Q").slice(0, 13)).toEqual(data);
  });

  it("interleaves the blocks of a version with blocks of two lengths", () => {
    // Version 5 at Q: two blocks of 15 data bytes, then two of 16.
    const data = Array.from({ length: 62 }, (_, index) => index);
    const result = codewords(data, 5, "Q");
    expect(result).toHaveLength(134);
    expect(result.slice(0, 8)).toEqual([0, 15, 30, 46, 1, 16, 31, 47]);
    // The last data bytes: only the long blocks have a 16th.
    expect(result.slice(60, 62)).toEqual([45, 61]);
  });
});

describe("place", () => {
  it("scales the modules to whole pixels and centres the code with its quiet zone", () => {
    // Version 1: 21 modules and 8 of quiet zone = 29; 256 / 29 is 8 pixels a module.
    expect(place(21, 256)).toEqual({ scale: 8, offset: 44 });
    const { scale, offset } = place(21, 256) ?? { scale: 0, offset: 0 };
    expect(offset).toBeGreaterThanOrEqual(QUIET_ZONE * scale);
    expect(256 - offset - 21 * scale).toBeGreaterThanOrEqual(QUIET_ZONE * scale);
  });

  it("refuses a code too fine for the size, and 384 pixels draw every version", () => {
    expect(place(61, 128)).toBeNull();
    expect(place(177, MAX_SIZE)?.scale).toBe(MIN_MODULE_PX);
    expect(smallestSizeFor(61)).toBe(192);
    // 384 pixels hold version 40 at two pixels a module: 384 / (177 + 8) = 2.07.
    expect(smallestSizeFor(177)).toBe(384);
    expect(SIZES[0]).toBe(MIN_SIZE);
  });
});

describe("run", () => {
  it("makes a code for a link", () => {
    const result = run({ text: "https://example.com/", level: "M", size: 256 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code.version).toBe(2);
    expect(result.placement).toEqual({ scale: 7, offset: 40 });
  });

  it("asks for text when there is none", () => {
    expect(run({ text: "", level: "M", size: 256 })).toEqual({
      ok: false,
      reason: "empty",
      error: MESSAGES.empty,
    });
  });

  it("says how much fits when the text is too long", () => {
    const result = run({ text: "a".repeat(2332), level: "M", size: 512 });
    expect(result).toMatchObject({ ok: false, reason: "too-long" });
    if (result.ok) return;
    expect(result.error).toContain("at most 2,331 bytes");
    expect(run({ text: "1".repeat(5597), level: "M", size: 512 })).toMatchObject({
      reason: "too-long",
    });
  });

  it("names a larger size when the code is too fine for the chosen one", () => {
    const result = run({ text: "a".repeat(200), level: "H", size: 128 });
    expect(result).toMatchObject({ ok: false, reason: "too-dense" });
    if (result.ok) return;
    expect(result.error).toMatch(/Choose \d+ pixels or more/);
  });

  it("refuses a size outside the range", () => {
    for (const size of [MIN_SIZE - 1, MAX_SIZE + 1, 200.5])
      expect(run({ text: "a", level: "M", size })).toMatchObject({ reason: "bad-size" });
  });
});
