import { describe, expect, it } from "vitest";
import {
  addMonths,
  daysInMonth,
  formatDate,
  isLeapYear,
  parseDate,
  run,
  toDayNumber,
} from "./logic";

const age = (birth: string, on: string) => run({ birth, on });

describe("calendar helpers", () => {
  it("knows leap years", () => {
    expect([2000, 2024, 1900, 2100, 2023].map(isLeapYear)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2023, 4)).toBe(30);
    expect(daysInMonth(2023, 12)).toBe(31);
  });

  it("numbers days from 1970-01-01", () => {
    expect(toDayNumber({ y: 1970, m: 1, d: 1 })).toBe(0);
    expect(toDayNumber({ y: 1970, m: 1, d: 2 })).toBe(1);
    expect(toDayNumber({ y: 1969, m: 12, d: 31 })).toBe(-1);
    expect(toDayNumber({ y: 2000, m: 3, d: 1 }) - toDayNumber({ y: 2000, m: 2, d: 28 })).toBe(2);
    expect(toDayNumber({ y: 1900, m: 3, d: 1 }) - toDayNumber({ y: 1900, m: 2, d: 28 })).toBe(1);
  });

  it("parses only real YYYY-MM-DD dates", () => {
    expect(parseDate("2024-02-29")).toEqual({ y: 2024, m: 2, d: 29 });
    expect(parseDate(" 0001-01-01 ")).toEqual({ y: 1, m: 1, d: 1 });
    expect(parseDate("9999-12-31")).toEqual({ y: 9999, m: 12, d: 31 });
    for (const bad of [
      "2023-02-29",
      "2023-13-01",
      "2023-00-10",
      "2023-04-31",
      "0000-01-01",
      "23-01-01",
      "2023/01/01",
      "x",
    ]) {
      expect(parseDate(bad), bad).toBeNull();
    }
  });

  it("writes a date for reading", () => {
    expect(formatDate({ y: 2026, m: 5, d: 3 })).toBe("3 May 2026");
  });

  it("adds months, using the last day of a shorter month", () => {
    expect(addMonths({ y: 2000, m: 1, d: 31 }, 1)).toEqual({ y: 2000, m: 2, d: 29 });
    expect(addMonths({ y: 2001, m: 1, d: 31 }, 1)).toEqual({ y: 2001, m: 2, d: 28 });
    expect(addMonths({ y: 2000, m: 11, d: 15 }, 3)).toEqual({ y: 2001, m: 2, d: 15 });
    expect(addMonths({ y: 2000, m: 2, d: 29 }, 12)).toEqual({ y: 2001, m: 2, d: 28 });
  });
});

describe("run", () => {
  it("answers the example of its page", () => {
    expect(age("1990-05-15", "2026-10-02")).toEqual({
      ok: true,
      years: 36,
      months: 4,
      days: 17,
      totalDays: 13289,
      next: { text: "Saturday, 15 May 2027", daysUntil: 225, turns: 37 },
    });
  });

  it("gives 0 years, 0 months and 0 days on the birth date itself", () => {
    expect(age("2020-06-10", "2020-06-10")).toMatchObject({
      years: 0,
      months: 0,
      days: 0,
      totalDays: 0,
      next: { daysUntil: 0, turns: 0 },
    });
  });

  it("shows a birthday that is today as 0 days away", () => {
    expect(age("1990-05-15", "2026-05-15")).toMatchObject({
      years: 36,
      months: 0,
      days: 0,
      next: { text: "Friday, 15 May 2026", daysUntil: 0, turns: 36 },
    });
  });

  it("counts the day before a birthday as one day short of the year", () => {
    expect(age("1990-05-15", "2026-05-14")).toMatchObject({
      years: 35,
      months: 11,
      days: 29,
      next: { daysUntil: 1, turns: 36 },
    });
  });

  it("handles a 29 February birth: 28 February in a common year", () => {
    expect(age("2000-02-29", "2001-02-28")).toMatchObject({
      years: 1,
      months: 0,
      days: 0,
      totalDays: 365,
      next: { text: "Wednesday, 28 February 2001", daysUntil: 0 },
    });
    expect(age("2000-02-29", "2001-02-27")).toMatchObject({ years: 0, months: 11, days: 29 });
    expect(age("2000-02-29", "2001-03-01")).toMatchObject({ years: 1, months: 0, days: 1 });
  });

  it("uses 29 February itself in a leap year", () => {
    expect(age("2000-02-29", "2024-02-29")).toMatchObject({
      years: 24,
      months: 0,
      days: 0,
      next: { text: "Thursday, 29 February 2024", daysUntil: 0, turns: 24 },
    });
    expect(age("2000-02-29", "2023-10-01").ok && age("2000-02-29", "2023-10-01")).toMatchObject({
      next: { text: "Thursday, 29 February 2024", turns: 24 },
    });
    expect(age("2000-02-29", "2026-10-02")).toMatchObject({
      years: 26,
      months: 7,
      days: 3,
      next: { text: "Sunday, 28 February 2027", daysUntil: 149, turns: 27 },
    });
  });

  it("handles a birth at the end of a long month", () => {
    expect(age("2023-01-31", "2023-02-28")).toMatchObject({ years: 0, months: 1, days: 0 });
    expect(age("2023-01-31", "2023-03-01")).toMatchObject({ years: 0, months: 1, days: 1 });
    expect(age("2023-01-31", "2023-02-27")).toMatchObject({ years: 0, months: 0, days: 27 });
  });

  it("agrees with the total days across a century that is not a leap year", () => {
    expect(age("1899-12-31", "1900-03-01")).toMatchObject({ totalDays: 60 });
    expect(age("1999-12-31", "2000-03-01")).toMatchObject({ totalDays: 61 });
  });

  it("works at the ends of the supported years", () => {
    expect(age("0001-01-01", "9999-12-31")).toMatchObject({
      ok: true,
      years: 9998,
      months: 11,
      days: 30,
    });
  });

  it("says plainly when the birth date is after the age-on date", () => {
    expect(age("2030-01-01", "2026-10-02")).toEqual({
      ok: false,
      field: "birth",
      error:
        "The birth date (1 January 2030) is after the age-on date (2 October 2026), so there is no age to show yet.",
    });
  });
});

describe("errors", () => {
  it("names the empty date", () => {
    expect(age("", "2026-10-02")).toEqual({
      ok: false,
      field: "birth",
      error: "Choose the birth date.",
    });
    expect(age("1990-05-15", " ")).toEqual({
      ok: false,
      field: "on",
      error: "Choose the age-on date.",
    });
  });

  it("explains a date that is not real", () => {
    const result = age("2023-02-29", "2026-10-02");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.field).toBe("birth");
    expect(!result.ok && result.error).toContain("not a real date");
    const second = age("1990-05-15", "2026-02-30");
    expect(!second.ok && second.field).toBe("on");
  });
});
