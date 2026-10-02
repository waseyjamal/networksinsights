import { describe, expect, it } from "vitest";
import { addDays, addMonths, countWeekdays, parseDate, run, toDayNumber } from "./logic";

const diff = (start: string, end: string, includeEnd = false) => run({ start, end, includeEnd });

describe("calendar helpers", () => {
  it("adds days across months, years and leap days", () => {
    expect(addDays({ y: 2026, m: 1, d: 31 }, 1)).toEqual({ y: 2026, m: 2, d: 1 });
    expect(addDays({ y: 2026, m: 12, d: 31 }, 1)).toEqual({ y: 2027, m: 1, d: 1 });
    expect(addDays({ y: 2024, m: 2, d: 28 }, 1)).toEqual({ y: 2024, m: 2, d: 29 });
    expect(addDays({ y: 2023, m: 2, d: 28 }, 1)).toEqual({ y: 2023, m: 3, d: 1 });
    expect(addDays({ y: 2026, m: 1, d: 1 }, 0)).toEqual({ y: 2026, m: 1, d: 1 });
    expect(addDays({ y: 2026, m: 1, d: 1 }, 365)).toEqual({ y: 2027, m: 1, d: 1 });
  });

  it("agrees with the day numbers", () => {
    const start = { y: 2026, m: 1, d: 5 };
    const end = addDays(start, 1234);
    expect(toDayNumber(end) - toDayNumber(start)).toBe(1234);
  });

  it("adds months, using the last day of a shorter month", () => {
    expect(addMonths({ y: 2026, m: 1, d: 31 }, 1)).toEqual({ y: 2026, m: 2, d: 28 });
  });

  it("parses only real dates", () => {
    expect(parseDate("2024-02-29")).toEqual({ y: 2024, m: 2, d: 29 });
    for (const bad of ["2023-02-29", "2023-13-01", "0000-01-01", "2023-1-1", "x"]) {
      expect(parseDate(bad), bad).toBeNull();
    }
  });

  it("counts the weekdays in a run of days", () => {
    const monday = toDayNumber({ y: 2026, m: 1, d: 5 });
    expect(countWeekdays(monday, 0)).toBe(0);
    expect(countWeekdays(monday, 5)).toBe(5);
    expect(countWeekdays(monday, 6)).toBe(5);
    expect(countWeekdays(monday, 7)).toBe(5);
    expect(countWeekdays(monday + 5, 2)).toBe(0);
    expect(countWeekdays(monday + 5, 3)).toBe(1);
    expect(countWeekdays(monday + 3, 365)).toBe(261);
  });
});

describe("run", () => {
  it("answers the example of its page", () => {
    expect(diff("2026-01-05", "2026-03-20")).toEqual({
      ok: true,
      years: 0,
      months: 2,
      days: 15,
      totalDays: 74,
      weeks: 10,
      extraDays: 4,
      weekdays: 54,
      swapped: false,
    });
  });

  it("counts the end date when asked, which adds one day to every measure", () => {
    expect(diff("2026-01-05", "2026-03-20", true)).toMatchObject({
      months: 2,
      days: 16,
      totalDays: 75,
      weeks: 10,
      extraDays: 5,
      weekdays: 55,
    });
  });

  it("gives 0 for the same date, and 1 when the end date is counted", () => {
    expect(diff("2026-05-05", "2026-05-05")).toMatchObject({
      years: 0,
      months: 0,
      days: 0,
      totalDays: 0,
      weekdays: 0,
    });
    expect(diff("2026-05-05", "2026-05-05", true)).toMatchObject({
      days: 1,
      totalDays: 1,
      weekdays: 1,
    });
    // 2026-05-09 is a Saturday.
    expect(diff("2026-05-09", "2026-05-09", true)).toMatchObject({ totalDays: 1, weekdays: 0 });
  });

  it("rolls a month at a time when the end date is counted", () => {
    expect(diff("2026-01-01", "2026-01-31", true)).toMatchObject({
      months: 1,
      days: 0,
      totalDays: 31,
    });
    expect(diff("2026-01-01", "2026-01-31")).toMatchObject({ months: 0, days: 30, totalDays: 30 });
  });

  it("counts whole years, and across a leap day", () => {
    expect(diff("2020-02-29", "2024-02-29")).toMatchObject({
      years: 4,
      months: 0,
      days: 0,
      totalDays: 1461,
    });
    expect(diff("2023-03-01", "2024-03-01")).toMatchObject({ years: 1, totalDays: 366 });
    expect(diff("2024-03-01", "2025-03-01")).toMatchObject({ years: 1, totalDays: 365 });
  });

  it("handles a start at the end of a long month", () => {
    expect(diff("2026-01-31", "2026-02-28")).toMatchObject({ months: 1, days: 0, totalDays: 28 });
    expect(diff("2026-01-31", "2026-03-01")).toMatchObject({ months: 1, days: 1, totalDays: 29 });
  });

  it("puts two dates in order when the end is before the start", () => {
    const backwards = diff("2026-03-20", "2026-01-05");
    const forwards = diff("2026-01-05", "2026-03-20");
    expect(backwards).toEqual({ ...forwards, swapped: true });
    expect(diff("2026-03-20", "2026-01-05", true)).toMatchObject({ totalDays: 75, swapped: true });
  });

  it("works at the ends of the supported years", () => {
    expect(diff("0001-01-01", "9999-12-31")).toMatchObject({
      ok: true,
      years: 9998,
      months: 11,
      days: 30,
    });
    expect(diff("0001-01-01", "9999-12-31", true)).toMatchObject({
      ok: true,
      years: 9999,
      months: 0,
      days: 0,
    });
  });
});

describe("errors", () => {
  it("names the empty date", () => {
    expect(diff("", "2026-01-01")).toEqual({
      ok: false,
      field: "start",
      error: "Choose the start date.",
    });
    expect(diff("2026-01-01", "")).toEqual({
      ok: false,
      field: "end",
      error: "Choose the end date.",
    });
  });

  it("explains a date that is not real", () => {
    const result = diff("2026-02-30", "2026-03-01");
    expect(!result.ok && result.field).toBe("start");
    expect(!result.ok && result.error).toContain("not a real date");
    expect(diff("2026-02-01", "10000-01-01")).toMatchObject({ ok: false, field: "end" });
  });
});
