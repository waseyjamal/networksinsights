import { describe, expect, it } from "vitest";
import { AUTO_MS_FROM, MAX_MS, MIN_MS, offsetAt, toDate, toStamp, zoneText } from "./logic";

describe("toDate", () => {
  it("answers the example of its page", () => {
    expect(toDate("1700000000", "auto")).toEqual({
      ok: true,
      unit: "seconds",
      ms: 1700000000000,
      utc: "2023-11-14 22:13:20.000 UTC",
      iso: "2023-11-14T22:13:20.000Z",
    });
  });

  it("detects milliseconds from 100,000,000,000 up", () => {
    expect(toDate("1700000000000", "auto")).toMatchObject({ unit: "milliseconds" });
    expect(toDate(String(AUTO_MS_FROM - 1), "auto")).toMatchObject({ unit: "seconds" });
    expect(toDate(String(AUTO_MS_FROM), "auto")).toMatchObject({ unit: "milliseconds" });
    expect(toDate(String(-AUTO_MS_FROM), "auto")).toMatchObject({ unit: "milliseconds" });
    expect(toDate("0", "auto")).toMatchObject({ iso: "1970-01-01T00:00:00.000Z" });
  });

  it("honours a chosen unit", () => {
    expect(toDate("1700000000000", "seconds")).toMatchObject({ ok: false });
    expect(toDate("1700000000", "milliseconds")).toMatchObject({
      iso: "1970-01-20T16:13:20.000Z",
    });
  });

  it("accepts the ends of the range and refuses one past them", () => {
    expect(toDate(String(MIN_MS), "milliseconds")).toMatchObject({
      iso: "0001-01-01T00:00:00.000Z",
    });
    expect(toDate(String(MAX_MS), "milliseconds")).toMatchObject({
      iso: "9999-12-31T23:59:59.999Z",
    });
    expect(toDate("-62135596800", "seconds")).toMatchObject({ ok: true });
    expect(toDate("253402300799", "seconds")).toMatchObject({ ok: true });
    expect(toDate(String(MIN_MS - 1), "milliseconds")).toMatchObject({ ok: false });
    expect(toDate(String(MAX_MS + 1), "milliseconds")).toMatchObject({ ok: false });
    expect(toDate("253402300800", "seconds")).toMatchObject({ ok: false });
    expect(toDate("-62135596801", "seconds")).toMatchObject({ ok: false });
  });

  it("refuses text, decimals and an empty box", () => {
    expect(toDate("", "auto")).toEqual({ ok: false, error: "Enter a timestamp." });
    expect(toDate("12.5", "auto")).toMatchObject({ ok: false });
    expect(toDate("abc", "auto")).toMatchObject({ ok: false });
  });
});

describe("time zones", () => {
  it("shows the wall clock and offset of a zone", () => {
    expect(zoneText(1700000000000, "Asia/Kolkata")).toBe("2023-11-15 03:43:20.000 UTC+05:30");
    expect(zoneText(1700000000000, "America/New_York")).toBe("2023-11-14 17:13:20.000 UTC-05:00");
    expect(zoneText(1700000000000, "UTC")).toBe("2023-11-14 22:13:20.000 UTC+00:00");
    expect(offsetAt(1689000000000, "America/New_York")).toBe(-4 * 3600 * 1000);
  });
});

describe("toStamp", () => {
  it("reads a date in UTC", () => {
    expect(toStamp("2023-11-14 22:13:20", "utc", "Asia/Kolkata")).toEqual({
      ok: true,
      seconds: "1700000000",
      milliseconds: "1700000000000",
      iso: "2023-11-14T22:13:20.000Z",
    });
    expect(toStamp("1970-01-01", "utc", "UTC")).toMatchObject({ seconds: "0" });
    expect(toStamp("2023-11-14T22:13:20.5", "utc", "UTC")).toMatchObject({
      milliseconds: "1700000000500",
    });
  });

  it("reads a date in a time zone", () => {
    expect(toStamp("2023-11-15 03:43:20", "local", "Asia/Kolkata")).toMatchObject({
      seconds: "1700000000",
    });
    expect(toStamp("2023-07-10 12:00", "local", "America/New_York")).toMatchObject({
      iso: "2023-07-10T16:00:00.000Z",
    });
  });

  it("accepts the ends of the range", () => {
    expect(toStamp("0001-01-01 00:00:00", "utc", "UTC")).toMatchObject({
      seconds: "-62135596800",
    });
    expect(toStamp("9999-12-31 23:59:59.999", "utc", "UTC")).toMatchObject({
      milliseconds: String(MAX_MS),
    });
    expect(toStamp("0000-12-31", "utc", "UTC")).toMatchObject({ ok: false });
  });

  it("refuses dates that do not exist and bad formats", () => {
    expect(toStamp("2023-02-29", "utc", "UTC")).toMatchObject({ ok: false });
    expect(toStamp("2024-02-29", "utc", "UTC")).toMatchObject({ ok: true });
    expect(toStamp("2023-01-01 24:00", "utc", "UTC")).toMatchObject({ ok: false });
    expect(toStamp("14/11/2023", "utc", "UTC")).toMatchObject({ ok: false });
    expect(toStamp("", "utc", "UTC")).toMatchObject({ ok: false });
  });
});
