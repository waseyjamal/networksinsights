// Pure logic of Unix Timestamp Converter: a Unix timestamp (time since 1970-01-01 00:00:00 UTC,
// leap seconds not counted) to a date in UTC, in a given time zone and in ISO 8601, and a date and
// time back to a timestamp. The time zone is passed in, so the logic never reads the device.

export type Unit = "auto" | "seconds" | "milliseconds";
export const UNITS = ["auto", "seconds", "milliseconds"] as const satisfies readonly Unit[];
export type Zone = "local" | "utc";
export const ZONES = ["local", "utc"] as const satisfies readonly Zone[];

/** The supported range: 0001-01-01T00:00:00.000Z to 9999-12-31T23:59:59.999Z, in milliseconds. */
export const MIN_MS = -62_135_596_800_000;
export const MAX_MS = 253_402_300_799_999;
/** In auto mode, a value whose size is at least this is read as milliseconds. */
export const AUTO_MS_FROM = 100_000_000_000;

export type ToDate =
  | { ok: true; unit: "seconds" | "milliseconds"; ms: number; utc: string; iso: string }
  | { ok: false; error: string };

export type ToStamp =
  | { ok: true; seconds: string; milliseconds: string; iso: string }
  | { ok: false; error: string };

const RANGE_ERROR =
  "That is outside the supported range, from year 0001 to year 9999 (0001-01-01 00:00:00 UTC to 9999-12-31 23:59:59.999 UTC).";

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

/** "YYYY-MM-DD HH:MM:SS.mmm" of a time in UTC. */
function utcText(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}

/** The wall-clock fields of an instant in a time zone. */
function wallClock(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    era: "short",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const era = parts.find((part) => part.type === "era")?.value ?? "AD";
  const year = era.startsWith("B") ? 1 - get("year") : get("year");
  return {
    year,
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** The offset of a time zone from UTC at an instant, in milliseconds. */
export function offsetAt(ms: number, timeZone: string): number {
  const w = wallClock(ms, timeZone);
  const asUtc = Date.UTC(2000, w.month - 1, w.day, w.hour, w.minute, w.second);
  const shifted = new Date(asUtc);
  shifted.setUTCFullYear(w.year);
  const whole = ms - (((ms % 1000) + 1000) % 1000);
  return shifted.getTime() - whole;
}

/** "YYYY-MM-DD HH:MM:SS.mmm UTC+05:30" of an instant in a time zone. */
export function zoneText(ms: number, timeZone: string): string {
  const offset = offsetAt(ms, timeZone);
  const total = Math.round(Math.abs(offset) / 1000);
  const sign = offset < 0 ? "-" : "+";
  // Old local mean times have offsets with seconds, such as +05:53:28; they are shown in full.
  const seconds = total % 60 === 0 ? "" : `:${pad(total % 60)}`;
  return `${utcText(ms + offset)} UTC${sign}${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}${seconds}`;
}

/** A timestamp to a date. `unit` "auto" reads values of 100,000,000,000 or more as milliseconds. */
export function toDate(text: string, unit: Unit): ToDate {
  const t = text.trim();
  if (t === "") return { ok: false, error: "Enter a timestamp." };
  if (!/^[-+]?\d+$/.test(t)) {
    return {
      ok: false,
      error: "A timestamp is a whole number of digits, with an optional minus sign.",
    };
  }
  const value = Number(t);
  const read =
    unit === "auto" ? (Math.abs(value) >= AUTO_MS_FROM ? "milliseconds" : "seconds") : unit;
  const ms = read === "seconds" ? value * 1000 : value;
  if (!Number.isSafeInteger(ms) || ms < MIN_MS || ms > MAX_MS) {
    return { ok: false, error: RANGE_ERROR };
  }
  const iso = new Date(ms).toISOString();
  return { ok: true, unit: read, ms, utc: `${utcText(ms)} UTC`, iso };
}

/**
 * A date and time, "YYYY-MM-DD", "YYYY-MM-DD HH:MM" or "YYYY-MM-DD HH:MM:SS(.mmm)", with a space or
 * a "T", read in UTC or in `timeZone`, to a timestamp.
 */
export function toStamp(text: string, zone: Zone, timeZone: string): ToStamp {
  const t = text.trim();
  if (t === "") return { ok: false, error: "Enter a date, such as 2023-11-14 22:13:20." };
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(
    t,
  );
  if (!m) {
    return {
      ok: false,
      error: "Write the date as YYYY-MM-DD, with an optional time HH:MM or HH:MM:SS.",
    };
  }
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map((v) => Number(v ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const milli = Number((m[7] ?? "0").padEnd(3, "0"));
  const probe = new Date(Date.UTC(2000, month - 1, day, hour, minute, second, milli));
  probe.setUTCFullYear(year);
  if (
    year < 1 ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return { ok: false, error: "That date or time does not exist. Check the month, day and time." };
  }
  let ms = probe.getTime();
  if (zone === "local") {
    const guess = ms - offsetAt(ms, timeZone);
    ms -= offsetAt(guess, timeZone);
  }
  if (ms < MIN_MS || ms > MAX_MS) return { ok: false, error: RANGE_ERROR };
  return {
    ok: true,
    seconds: String(Math.floor(ms / 1000)),
    milliseconds: String(ms),
    iso: new Date(ms).toISOString(),
  };
}
