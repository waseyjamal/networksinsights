import { describe, expect, it } from "vitest";
import { BRACKETS, type Status } from "./data";
import { formatBasisPoints, formatCents, MAX_DOLLARS, MESSAGES, run, taxCents } from "./logic";

const dollars = (value: number) => Math.round(value * 100);

/**
 * Rev. Proc. 2025-32, section 3.01, Tables 1 to 4: for each status, the tax at the top of every
 * bracket, read from "$X plus r% of the excess over $Y" in the next row.
 */
const SCHEDULES: Record<Status, ReadonlyArray<[number, number]>> = {
  joint: [
    [24_800, 2_480],
    [100_800, 11_600],
    [211_400, 35_932],
    [403_550, 82_048],
    [512_450, 116_896],
    [768_700, 206_583.5],
  ],
  head: [
    [17_700, 1_770],
    [67_450, 7_740],
    [105_700, 16_155],
    [201_750, 39_207],
    [256_200, 56_631],
    [640_600, 191_171],
  ],
  single: [
    [12_400, 1_240],
    [50_400, 5_800],
    [105_700, 17_966],
    [201_775, 41_024],
    [256_225, 58_448],
    [640_600, 192_979.25],
  ],
  separate: [
    [12_400, 1_240],
    [50_400, 5_800],
    [105_700, 17_966],
    [201_775, 41_024],
    [256_225, 58_448],
    [384_350, 103_291.75],
  ],
};

describe("the 2026 rate schedules of Rev. Proc. 2025-32", () => {
  for (const status of Object.keys(SCHEDULES) as Status[]) {
    it(`matches every base amount for ${status}, and the rate one dollar either side`, () => {
      const brackets = BRACKETS[status];
      for (const [index, [edge, tax]] of SCHEDULES[status].entries()) {
        const below = brackets[index]?.rate ?? 0;
        const above = brackets[index + 1]?.rate ?? 0;
        expect(taxCents(edge, status)).toBe(dollars(tax));
        expect(taxCents(edge - 1, status)).toBe(dollars(tax) - below);
        expect(taxCents(edge + 1, status)).toBe(dollars(tax) + above);
      }
    });
  }
});

describe("run", () => {
  it("takes the standard deduction: single, $100,000 leaves $83,900 taxable", () => {
    const result = run({
      income: "100,000",
      status: "single",
      deduction: "standard",
      itemized: "",
    });
    expect(result).toMatchObject({
      ok: true,
      deduction: 16_100,
      taxable: 83_900,
      taxCents: dollars(5_800 + 7_370),
      marginalRate: 22,
    });
    // 13,170 / 100,000 = 13.17%
    expect(result.ok && formatBasisPoints(result.effectiveBasisPoints)).toBe("13.17%");
  });

  it("uses each status's standard deduction", () => {
    const deduction = (status: Status) => {
      const result = run({ income: "50000", status, deduction: "standard", itemized: "" });
      return result.ok ? result.deduction : -1;
    };
    expect(deduction("joint")).toBe(32_200);
    expect(deduction("head")).toBe(24_150);
    expect(deduction("single")).toBe(16_100);
    expect(deduction("separate")).toBe(16_100);
  });

  it("takes itemized deductions, or none", () => {
    const itemized = run({
      income: "80000",
      status: "joint",
      deduction: "itemized",
      itemized: "40,000",
    });
    expect(itemized).toMatchObject({ ok: true, taxable: 40_000, taxCents: dollars(2_480 + 1_824) });
    const none = run({ income: "24800", status: "joint", deduction: "none", itemized: "x" });
    expect(none).toMatchObject({
      ok: true,
      taxable: 24_800,
      taxCents: dollars(2_480),
      marginalRate: 10,
    });
  });

  it("gives nil tax at zero income and when the deduction is larger than the income", () => {
    expect(run({ income: "0", status: "single", deduction: "none", itemized: "" })).toMatchObject({
      ok: true,
      taxCents: 0,
      marginalRate: 10,
      effectiveBasisPoints: 0,
    });
    expect(
      run({ income: "16100", status: "single", deduction: "standard", itemized: "" }),
    ).toMatchObject({
      ok: true,
      taxable: 0,
      taxCents: 0,
    });
  });

  it("works to $1 billion and refuses more", () => {
    const top = run({
      income: String(MAX_DOLLARS),
      status: "single",
      deduction: "none",
      itemized: "",
    });
    expect(top).toMatchObject({
      ok: true,
      taxCents: dollars(192_979.25) + (MAX_DOLLARS - 640_600) * 37,
      marginalRate: 37,
    });
    expect(
      run({ income: String(MAX_DOLLARS + 1), status: "single", deduction: "none", itemized: "" }),
    ).toEqual({
      ok: false,
      field: "income",
      error: MESSAGES.income,
    });
  });

  it("refuses empty, negative, decimal and non-numeric amounts", () => {
    for (const bad of ["", " ", "-5", "1000.50", "abc", "1e5"]) {
      expect(run({ income: bad, status: "single", deduction: "standard", itemized: "" })).toEqual({
        ok: false,
        field: "income",
        error: MESSAGES.income,
      });
      expect(
        run({ income: "1000", status: "single", deduction: "itemized", itemized: bad }),
      ).toEqual({
        ok: false,
        field: "itemized",
        error: MESSAGES.itemized,
      });
    }
  });
});

describe("formatting", () => {
  it("shows dollars and cents", () => {
    expect(formatCents(dollars(206_583.5))).toBe("$206,583.50");
    expect(formatCents(0)).toBe("$0.00");
  });
});
