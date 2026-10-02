import { describe, expect, it } from "vitest";
import { FALLBACK_ZONES, formatOffset, isValidZone, MAX_TARGETS, run, zoneList } from "./logic";

const convert = (date: string, time: string, source: string, ...targets: string[]) =>
  run({ date, time, source, targets });

function ok(result: ReturnType<typeof run>) {
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe("zoneList", () => {
  it("uses the fixed list when the browser has none, and every name in it is real", () => {
    expect(zoneList(null)).toEqual([...FALLBACK_ZONES]);
    expect(zoneList([])).toEqual([...FALLBACK_ZONES]);
    expect(FALLBACK_ZONES).toHaveLength(43);
    expect(new Set(FALLBACK_ZONES).size).toBe(FALLBACK_ZONES.length);
    for (const zone of FALLBACK_ZONES) expect(isValidZone(zone), zone).toBe(true);
  });

  it("sorts the browser's list, drops repeats and adds UTC when it is missing", () => {
    expect(zoneList(["Europe/Paris", "Asia/Tokyo", "Europe/Paris"])).toEqual([
      "UTC",
      "Asia/Tokyo",
      "Europe/Paris",
    ]);
    expect(zoneList(["UTC", "Asia/Tokyo"])).toEqual(["Asia/Tokyo", "UTC"]);
  });

  it("works with the list of this runtime", () => {
    const zones = zoneList(Intl.supportedValuesOf("timeZone"));
    expect(zones).toContain("UTC");
    expect(zones).toContain("America/New_York");
    for (const zone of zones) expect(isValidZone(zone), zone).toBe(true);
  });
});

describe("isValidZone", () => {
  it("accepts IANA names and refuses the rest", () => {
    expect(isValidZone("Asia/Kolkata")).toBe(true);
    expect(isValidZone("UTC")).toBe(true);
    for (const bad of ["", " ", "Mars/Olympus", "New York", "EST5EDT5", " UTC"]) {
      expect(isValidZone(bad), bad).toBe(false);
    }
  });
});

describe("formatOffset", () => {
  it("writes whole, half and quarter hours", () => {
    expect(formatOffset(0)).toBe("UTC+00:00");
    expect(formatOffset(-4 * 3_600_000)).toBe("UTC-04:00");
    expect(formatOffset(5.5 * 3_600_000)).toBe("UTC+05:30");
    expect(formatOffset(5.75 * 3_600_000)).toBe("UTC+05:45");
  });
});

describe("run", () => {
  it("answers the example of its page", () => {
    const result = ok(
      convert(
        "2026-07-15",
        "09:00",
        "America/New_York",
        "Europe/London",
        "Asia/Kolkata",
        "Asia/Tokyo",
      ),
    );
    expect(result.utc).toBe("2026-07-15 13:00 UTC");
    expect(result.source).toEqual({
      zone: "America/New_York",
      date: "Wed, 15 Jul 2026",
      time: "09:00",
      offset: "UTC-04:00",
      dayShift: 0,
    });
    expect(result.targets.map((row) => [row.zone, row.time, row.offset, row.dayShift])).toEqual([
      ["Europe/London", "14:00", "UTC+01:00", 0],
      ["Asia/Kolkata", "18:30", "UTC+05:30", 0],
      ["Asia/Tokyo", "22:00", "UTC+09:00", 0],
    ]);
    expect(result.notice).toBeNull();
  });

  it("follows daylight saving: the same clock time has different offsets in winter and summer", () => {
    expect(
      ok(convert("2026-01-15", "09:00", "America/New_York", "Europe/London")).targets[0],
    ).toMatchObject({
      time: "14:00",
      offset: "UTC+00:00",
    });
    expect(
      ok(convert("2026-07-15", "09:00", "America/New_York", "Europe/London")).targets[0],
    ).toMatchObject({
      time: "14:00",
      offset: "UTC+01:00",
    });
    // The two zones change on different dates: on 2026-03-20 New York is on summer time and London is not.
    expect(
      ok(convert("2026-03-20", "09:00", "America/New_York", "Europe/London")).targets[0],
    ).toMatchObject({
      time: "13:00",
    });
  });

  it("shows the date on each clock, a day later or earlier", () => {
    const late = ok(
      convert("2026-07-15", "23:00", "America/New_York", "Asia/Tokyo", "Pacific/Honolulu"),
    );
    expect(late.targets[0]).toMatchObject({ date: "Thu, 16 Jul 2026", time: "12:00", dayShift: 1 });
    expect(late.targets[1]).toMatchObject({ date: "Wed, 15 Jul 2026", time: "17:00", dayShift: 0 });
    const early = ok(convert("2026-07-15", "01:00", "Asia/Tokyo", "America/New_York"));
    expect(early.targets[0]).toMatchObject({
      date: "Tue, 14 Jul 2026",
      time: "12:00",
      dayShift: -1,
    });
  });

  it("handles half-hour and quarter-hour zones and a zone converted to itself", () => {
    expect(ok(convert("2026-07-15", "12:00", "UTC", "Asia/Kathmandu")).targets[0]).toMatchObject({
      time: "17:45",
      offset: "UTC+05:45",
    });
    expect(
      ok(convert("2026-07-15", "12:00", "Asia/Kolkata", "Asia/Kolkata")).targets[0],
    ).toMatchObject({
      time: "12:00",
      dayShift: 0,
    });
  });

  it("handles the ends of the supported years and a leap day", () => {
    expect(ok(convert("1970-01-01", "00:00", "UTC", "Asia/Tokyo")).targets[0]).toMatchObject({
      time: "09:00",
    });
    expect(ok(convert("2100-12-31", "23:59", "UTC", "Asia/Tokyo")).targets[0]).toMatchObject({
      date: "Sat, 1 Jan 2101",
      time: "08:59",
    });
    expect(ok(convert("2028-02-29", "12:00", "UTC", "Asia/Tokyo")).targets[0]).toMatchObject({
      date: "Tue, 29 Feb 2028",
    });
  });
});

describe("a time that does not exist", () => {
  it("is moved forward by the length of the skip (New York, spring)", () => {
    const result = ok(convert("2026-03-08", "02:30", "America/New_York", "UTC", "Europe/London"));
    expect(result.utc).toBe("2026-03-08 07:30 UTC");
    expect(result.source).toMatchObject({ time: "03:30", offset: "UTC-04:00" });
    expect(result.notice).toEqual({
      kind: "gap",
      text: "02:30 does not exist in America/New_York on Sun, 8 Mar 2026, because the clocks skip forward. It is moved forward by the length of the skip, to 03:30.",
    });
    expect(result.targets[0]).toMatchObject({ time: "07:30" });
  });

  it("is moved forward in other zones too (London, Sydney)", () => {
    const london = ok(convert("2026-03-29", "01:30", "Europe/London", "UTC"));
    expect(london.source).toMatchObject({ time: "02:30", offset: "UTC+01:00" });
    expect(london.notice?.kind).toBe("gap");
    const sydney = ok(convert("2026-10-04", "02:30", "Australia/Sydney", "UTC"));
    expect(sydney.source).toMatchObject({ time: "03:30", offset: "UTC+11:00" });
    expect(sydney.notice?.kind).toBe("gap");
  });

  it("does not touch the times either side of the skip", () => {
    expect(ok(convert("2026-03-08", "01:59", "America/New_York", "UTC")).notice).toBeNull();
    expect(ok(convert("2026-03-08", "03:00", "America/New_York", "UTC")).notice).toBeNull();
    expect(ok(convert("2026-03-08", "03:00", "America/New_York", "UTC")).utc).toBe(
      "2026-03-08 07:00 UTC",
    );
  });
});

describe("a time that happens twice", () => {
  it("is read as the first time, and the notice names both (New York, autumn)", () => {
    const result = ok(convert("2026-11-01", "01:30", "America/New_York", "UTC"));
    expect(result.utc).toBe("2026-11-01 05:30 UTC");
    expect(result.source).toMatchObject({ time: "01:30", offset: "UTC-04:00" });
    expect(result.notice).toEqual({
      kind: "overlap",
      text: "01:30 happens twice in America/New_York on Sun, 1 Nov 2026, because the clocks go back. The first time, at UTC-04:00, is used; the second is at UTC-05:00.",
    });
  });

  it("works in the southern hemisphere and in London", () => {
    const sydney = ok(convert("2026-04-05", "02:30", "Australia/Sydney", "UTC"));
    expect(sydney.utc).toBe("2026-04-04 15:30 UTC");
    expect(sydney.notice?.kind).toBe("overlap");
    const london = ok(convert("2026-10-25", "01:30", "Europe/London", "UTC"));
    expect(london.utc).toBe("2026-10-25 00:30 UTC");
    expect(london.notice?.kind).toBe("overlap");
  });

  it("does not touch the times either side of the overlap", () => {
    expect(ok(convert("2026-11-01", "00:59", "America/New_York", "UTC")).notice).toBeNull();
    expect(ok(convert("2026-11-01", "02:00", "America/New_York", "UTC")).notice).toBeNull();
    expect(ok(convert("2026-11-01", "02:00", "America/New_York", "UTC")).utc).toBe(
      "2026-11-01 07:00 UTC",
    );
  });
});

describe("errors", () => {
  it("names a missing or invalid date and time", () => {
    expect(convert("", "09:00", "UTC", "UTC")).toEqual({
      ok: false,
      field: "date",
      error: "Choose a date.",
    });
    expect(convert("2026-07-15", "", "UTC", "UTC")).toEqual({
      ok: false,
      field: "time",
      error: "Choose a time.",
    });
    expect(convert("15/07/2026", "09:00", "UTC", "UTC")).toMatchObject({
      ok: false,
      field: "date",
    });
    expect(convert("2026-02-30", "09:00", "UTC", "UTC")).toEqual({
      ok: false,
      field: "date",
      error: "That date does not exist in the calendar.",
    });
    expect(convert("1969-12-31", "09:00", "UTC", "UTC")).toEqual({
      ok: false,
      field: "date",
      error: "The year must be from 1970 to 2100.",
    });
    expect(convert("2101-01-01", "09:00", "UTC", "UTC")).toMatchObject({
      ok: false,
      field: "date",
    });
    for (const bad of ["24:00", "09:60", "9:00", "09:00:30", "noon"]) {
      expect(convert("2026-07-15", bad, "UTC", "UTC"), bad).toMatchObject({
        ok: false,
        field: "time",
      });
    }
  });

  it("refuses an unknown zone", () => {
    expect(convert("2026-07-15", "09:00", "Mars/Olympus", "UTC")).toEqual({
      ok: false,
      field: "source",
      error: '"Mars/Olympus" is not a time zone this browser knows.',
    });
    expect(convert("2026-07-15", "09:00", "UTC", "UTC", "Nowhere")).toMatchObject({
      ok: false,
      field: "targets",
    });
  });

  it("needs 1 to 10 target zones", () => {
    expect(convert("2026-07-15", "09:00", "UTC")).toEqual({
      ok: false,
      field: "targets",
      error: "Add at least one zone to convert to.",
    });
    const ten = FALLBACK_ZONES.slice(0, MAX_TARGETS);
    expect(convert("2026-07-15", "09:00", "UTC", ...ten).ok).toBe(true);
    expect(
      convert("2026-07-15", "09:00", "UTC", ...FALLBACK_ZONES.slice(0, MAX_TARGETS + 1)),
    ).toEqual({
      ok: false,
      field: "targets",
      error: "Use at most 10 zones to convert to.",
    });
  });
});
