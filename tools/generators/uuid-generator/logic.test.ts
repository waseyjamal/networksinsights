import { describe, expect, it } from "vitest";
import {
  BYTES_PER_UUID,
  buildUuids,
  formatUuid,
  MAX_COUNT,
  MAX_TIMESTAMP_MS,
  parseCount,
  run,
} from "./logic";

const filled = (value: number, count = 1) => new Uint8Array(count * BYTES_PER_UUID).fill(value);
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// 1700000000000 ms is 0x018BCFE56800.
const NOW = 1_700_000_000_000;

describe("parseCount", () => {
  it("accepts 1 to 1,000", () => {
    expect(parseCount("1")).toEqual({ ok: true, count: 1 });
    expect(parseCount(" 1000 ")).toEqual({ ok: true, count: 1000 });
    expect(parseCount("007")).toEqual({ ok: true, count: 7 });
  });

  it("refuses the rest, with a message", () => {
    expect(parseCount("")).toEqual({ ok: false, error: "Enter how many UUIDs you want." });
    for (const bad of ["0", "1001", "-5", "2.5", "ten", "1e2", "1,000"]) {
      expect(parseCount(bad).ok, bad).toBe(false);
    }
    expect(parseCount("1001")).toEqual({ ok: false, error: "Choose from 1 to 1000 UUIDs." });
    expect(parseCount("2.5")).toEqual({
      ok: false,
      error: "Use a whole number of UUIDs, such as 10.",
    });
  });
});

describe("version 4", () => {
  it("sets the version and variant bits and keeps the other bits", () => {
    expect(buildUuids("4", 1, { random: filled(0xff), timestampMs: NOW })).toEqual([
      "ffffffff-ffff-4fff-bfff-ffffffffffff",
    ]);
    expect(buildUuids("4", 1, { random: filled(0x00), timestampMs: NOW })).toEqual([
      "00000000-0000-4000-8000-000000000000",
    ]);
  });

  it("ignores the clock", () => {
    const random = filled(0x5a);
    expect(buildUuids("4", 1, { random, timestampMs: 0 })).toEqual(
      buildUuids("4", 1, { random, timestampMs: NOW }),
    );
  });

  it("uses fresh bytes for each UUID and does not change the bytes it was given", () => {
    const random = new Uint8Array(2 * BYTES_PER_UUID);
    random.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 0);
    random.set([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 16);
    const copy = random.slice();
    const [first, second] = buildUuids("4", 2, { random, timestampMs: NOW });
    expect(first).toBe("01020304-0506-4708-890a-0b0c0d0e0f10");
    expect(second).toBe("100f0e0d-0c0b-4a09-8807-060504030201");
    expect(random).toEqual(copy);
  });

  it("matches the pattern for random input", () => {
    const random = new Uint8Array(50 * BYTES_PER_UUID);
    for (let i = 0; i < random.length; i += 1) random[i] = (i * 37 + 11) % 256;
    for (const uuid of buildUuids("4", 50, { random, timestampMs: NOW })) {
      expect(uuid).toMatch(V4);
    }
  });
});

describe("version 7", () => {
  it("puts the 48-bit time first, then version 7 and variant 10", () => {
    expect(buildUuids("7", 1, { random: filled(0x00), timestampMs: NOW })).toEqual([
      "018bcfe5-6800-7000-8000-000000000000",
    ]);
    expect(buildUuids("7", 1, { random: filled(0xff), timestampMs: NOW })).toEqual([
      "018bcfe5-6800-77ff-bfff-ffffffffffff",
    ]);
  });

  it("handles the smallest and the largest time", () => {
    expect(buildUuids("7", 1, { random: filled(0), timestampMs: 0 })[0]).toBe(
      "00000000-0000-7000-8000-000000000000",
    );
    expect(buildUuids("7", 1, { random: filled(0), timestampMs: MAX_TIMESTAMP_MS })[0]).toBe(
      "ffffffff-ffff-7000-8000-000000000000",
    );
  });

  it("counts up inside a batch, so the batch sorts in the order made", () => {
    const uuids = buildUuids("7", 3, { random: filled(0, 3), timestampMs: NOW });
    expect(uuids).toEqual([
      "018bcfe5-6800-7000-8000-000000000000",
      "018bcfe5-6800-7001-8000-000000000000",
      "018bcfe5-6800-7002-8000-000000000000",
    ]);
  });

  it("never overflows the counter, even at the top of its starting range", () => {
    // Random bytes 6 and 7 of the first UUID are 0xff 0xff: the counter starts at 0x7ff (2047).
    const random = filled(0xff, MAX_COUNT);
    const uuids = buildUuids("7", MAX_COUNT, { random, timestampMs: NOW });
    expect(uuids).toHaveLength(MAX_COUNT);
    expect(uuids.every((uuid) => V7.test(uuid))).toBe(true);
    expect([...uuids].sort()).toEqual(uuids);
    expect(new Set(uuids.map((uuid) => uuid.slice(0, 18))).size).toBe(MAX_COUNT);
  });
});

describe("buildUuids", () => {
  it("refuses too few random bytes", () => {
    expect(() => buildUuids("4", 2, { random: filled(1), timestampMs: NOW })).toThrow(RangeError);
  });
});

describe("formatUuid", () => {
  const uuid = "018bcfe5-6800-7abc-8def-0123456789ab";
  const off = { uppercase: false, noHyphens: false, braces: false };

  it("writes each option alone and all together", () => {
    expect(formatUuid(uuid, off)).toBe(uuid);
    expect(formatUuid(uuid, { ...off, uppercase: true })).toBe(
      "018BCFE5-6800-7ABC-8DEF-0123456789AB",
    );
    expect(formatUuid(uuid, { ...off, noHyphens: true })).toBe("018bcfe568007abc8def0123456789ab");
    expect(formatUuid(uuid, { ...off, braces: true })).toBe(`{${uuid}}`);
    expect(formatUuid(uuid, { uppercase: true, noHyphens: true, braces: true })).toBe(
      "{018BCFE568007ABC8DEF0123456789AB}",
    );
  });
});

describe("run", () => {
  const options = { uppercase: false, noHyphens: false, braces: false };

  it("returns one UUID per line, written with the options", () => {
    const result = run(
      { version: "4", count: "3", ...options, uppercase: true, braces: true },
      { random: filled(0xab, 3), timestampMs: NOW },
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.uuids).toHaveLength(3);
    expect(result.text.split("\n")).toEqual(result.uuids);
    expect(result.uuids[0]).toBe("{ABABABAB-ABAB-4BAB-ABAB-ABABABABABAB}");
  });

  it("passes on a count error", () => {
    expect(
      run({ version: "4", count: "0", ...options }, { random: filled(0), timestampMs: NOW }),
    ).toEqual({
      ok: false,
      error: "Choose from 1 to 1000 UUIDs.",
    });
  });

  it("refuses a clock reading a version 7 UUID cannot hold, only for version 7", () => {
    const bad = { random: filled(0), timestampMs: MAX_TIMESTAMP_MS + 1 };
    expect(run({ version: "7", count: "1", ...options }, bad).ok).toBe(false);
    expect(run({ version: "7", count: "1", ...options }, { ...bad, timestampMs: -1 }).ok).toBe(
      false,
    );
    expect(run({ version: "7", count: "1", ...options }, { ...bad, timestampMs: 1.5 }).ok).toBe(
      false,
    );
    expect(run({ version: "4", count: "1", ...options }, bad).ok).toBe(true);
  });
});
