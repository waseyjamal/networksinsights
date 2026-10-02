// Pure logic of Time Zone Converter: a date and a time on a clock in one IANA time zone, shown on
// the clocks of other zones. Offsets and daylight saving rules come from Intl, that is, from the
// time zone data of the browser; this file holds no rules of its own.
//
// Two clock times are special at a daylight saving change, and both get one fixed rule:
//   - A time that does not exist (the clocks skip forward) is moved forward by the length of the
//     skip: 02:30 where the clock jumps from 02:00 to 03:00 becomes 03:30.
//   - A time that happens twice (the clocks go back) is read as the first time it happens,
//     before the clocks go back. The second one is named in the notice.

/** The first and last year accepted, and the most target zones. */
export const MIN_YEAR = 1970;
export const MAX_YEAR = 2100;
export const MAX_TARGETS = 10;

/**
 * The zones offered when the browser cannot list its own (`Intl.supportedValuesOf`): a fixed list
 * of widely used IANA names, UTC first.
 */
export const FALLBACK_ZONES: readonly string[] = [
  "UTC",
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Halifax",
  "America/St_Johns",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "Atlantic/Reykjavik",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Africa/Lagos",
  "Africa/Cairo",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
];

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  /** `YYYY-MM-DD`, a date on the clock of `source`. */
  date: string;
  /** `HH:MM`, 24-hour, on the clock of `source`. */
  time: string;
  source: string;
  targets: string[];
}

export interface Row {
  zone: string;
  /** For example "Wed, 15 Jul 2026". */
  date: string;
  /** For example "14:00". */
  time: string;
  /** For example "UTC+01:00". */
  offset: string;
  /** Whole days from the date on the source clock: -1, 0 or 1. */
  dayShift: number;
}

export interface Notice {
  kind: "gap" | "overlap";
  text: string;
}

export type Result =
  | {
      ok: true;
      /** The moment in UTC, for example "2026-07-15 13:00 UTC". */
      utc: string;
      /** The time on the source clock, after any move forward. */
      source: Row;
      targets: Row[];
      notice: Notice | null;
    }
  | { ok: false; field: "date" | "time" | "source" | "targets"; error: string };

/**
 * The zones to offer: the browser's own list when it has one (sorted, with UTC added if missing),
 * otherwise FALLBACK_ZONES. Pass `Intl.supportedValuesOf("timeZone")`, or null when the browser
 * has no such function.
 */
export function zoneList(supported: readonly string[] | null): string[] {
  if (!supported || supported.length === 0) return [...FALLBACK_ZONES];
  const zones = [...new Set(supported)].sort();
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  const known = formatters.get(zone);
  if (known) return known;
  const made = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  formatters.set(zone, made);
  return made;
}

/** True when the browser knows `zone` as an IANA time zone. */
export function isValidZone(zone: string): boolean {
  if (zone.trim() === "" || zone !== zone.trim()) return false;
  try {
    formatterFor(zone);
    return true;
  } catch {
    return false;
  }
}

/** The clock of `zone` at an instant, as milliseconds counted as if that clock were UTC. */
function wallClock(instant: number, zone: string): number {
  const parts = formatterFor(zone).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const hour = get("hour") % 24;
  return Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
}

/** The offset of `zone` from UTC at an instant, in milliseconds. */
function offsetAt(instant: number, zone: string): number {
  return wallClock(instant, zone) - instant;
}

const DAY_MS = 86_400_000;

export function formatOffset(offsetMs: number): string {
  const minutes = Math.round(offsetMs / 60_000);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const pad = (n: number) => String(n).padStart(2, "0");

/** "Wed, 15 Jul 2026" for a clock reading counted as UTC. */
function dateText(wall: number): string {
  const d = new Date(wall);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function timeText(wall: number): string {
  const d = new Date(wall);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function rowFor(instant: number, zone: string, sourceDay: number): Row {
  const wall = wallClock(instant, zone);
  return {
    zone,
    date: dateText(wall),
    time: timeText(wall),
    offset: formatOffset(wall - instant),
    dayShift: Math.floor(wall / DAY_MS) - sourceDay,
  };
}

/** Reads `YYYY-MM-DD` and `HH:MM` as a clock reading counted as UTC, or says what is wrong. */
function readClock(date: string, time: string): number | Extract<Result, { ok: false }> {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (date.trim() === "") return { ok: false, field: "date", error: "Choose a date." };
  if (!d) {
    return { ok: false, field: "date", error: "The date is not valid. Use the form YYYY-MM-DD." };
  }
  const y = Number(d[1]);
  const m = Number(d[2]);
  const day = Number(d[3]);
  const check = new Date(Date.UTC(y, m - 1, day));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== day) {
    return { ok: false, field: "date", error: "That date does not exist in the calendar." };
  }
  if (y < MIN_YEAR || y > MAX_YEAR) {
    return { ok: false, field: "date", error: `The year must be from ${MIN_YEAR} to ${MAX_YEAR}.` };
  }
  if (time.trim() === "") return { ok: false, field: "time", error: "Choose a time." };
  const t = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) {
    return {
      ok: false,
      field: "time",
      error: "The time is not valid. Use 24-hour HH:MM, from 00:00 to 23:59.",
    };
  }
  return Date.UTC(y, m - 1, day, Number(t[1]), Number(t[2]));
}

/** Converts the time on the clock of `source` to every target zone, or says what is wrong. */
export function run(input: Input): Result {
  const clock = readClock(input.date, input.time);
  if (typeof clock !== "number") return clock;
  if (!isValidZone(input.source)) {
    return {
      ok: false,
      field: "source",
      error: `"${input.source}" is not a time zone this browser knows.`,
    };
  }
  if (input.targets.length === 0) {
    return { ok: false, field: "targets", error: "Add at least one zone to convert to." };
  }
  if (input.targets.length > MAX_TARGETS) {
    return {
      ok: false,
      field: "targets",
      error: `Use at most ${MAX_TARGETS} zones to convert to.`,
    };
  }
  const unknown = input.targets.find((zone) => !isValidZone(zone)) ?? null;
  if (unknown !== null) {
    return {
      ok: false,
      field: "targets",
      error: `"${unknown}" is not a time zone this browser knows.`,
    };
  }

  // The instants whose clock in `source` reads `clock`: none in a skip, two when clocks go back.
  const before = offsetAt(clock - DAY_MS, input.source);
  const after = offsetAt(clock + DAY_MS, input.source);
  const found = [...new Set([before, after])]
    .map((offset) => clock - offset)
    .filter((instant) => wallClock(instant, input.source) === clock)
    .sort((a, b) => a - b);

  let instant: number;
  let notice: Notice | null = null;
  const first = found[0] ?? clock;
  const second = found[1] ?? null;
  if (found.length === 0) {
    instant = clock - before;
    const moved = wallClock(instant, input.source);
    notice = {
      kind: "gap",
      text: `${input.time} does not exist in ${input.source} on ${dateText(clock)}, because the clocks skip forward. It is moved forward by the length of the skip, to ${timeText(moved)}.`,
    };
  } else {
    instant = first;
    if (second !== null) {
      notice = {
        kind: "overlap",
        text: `${input.time} happens twice in ${input.source} on ${dateText(clock)}, because the clocks go back. The first time, at ${formatOffset(clock - first)}, is used; the second is at ${formatOffset(clock - second)}.`,
      };
    }
  }

  const sourceDay = Math.floor(wallClock(instant, input.source) / DAY_MS);
  const utc = new Date(instant);
  return {
    ok: true,
    utc: `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())} ${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())} UTC`,
    source: rowFor(instant, input.source, sourceDay),
    targets: input.targets.map((zone) => rowFor(instant, zone, sourceDay)),
    notice,
  };
}
