// Pure logic of Age Calculator: the exact age between a birth date and a second date, in years,
// months and days, with the total days and the next birthday. Dates are plain calendar dates
// (year, month, day) in the proleptic Gregorian calendar; no time zone is involved, so nothing
// depends on the device clock here (the page passes today's date in).

/** The first and last year the tool accepts. */
export const MIN_YEAR = 1;
export const MAX_YEAR = 9999;

/** What the tool accepts, as `YYYY-MM-DD` text. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  birth: string;
  /** The date to measure the age on. */
  on: string;
}

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export interface NextBirthday {
  /** For example "Friday, 15 May 2026". */
  text: string;
  /** Whole days from the "age on" date to that birthday; 0 when it is that very day. */
  daysUntil: number;
  /** The age the person turns on that day. */
  turns: number;
}

export type Result =
  | {
      ok: true;
      years: number;
      months: number;
      days: number;
      totalDays: number;
      next: NextBirthday;
    }
  | { ok: false; field: "birth" | "on"; error: string };

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** Days since 1970-01-01 of a calendar date (Howard Hinnant's civil-days algorithm). */
export function toDayNumber({ y, m, d }: Ymd): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Reads `YYYY-MM-DD` as a real calendar date, or null when it is not one. */
export function parseDate(text: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < MIN_YEAR || y > MAX_YEAR || m < 1 || m > 12) return null;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

/** A date written for reading: "15 May 2026". */
export function formatDate({ y, m, d }: Ymd): string {
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function weekdayName(date: Ymd): string {
  // 1970-01-01 was a Thursday (index 4).
  const index = (((toDayNumber(date) + 4) % 7) + 7) % 7;
  return WEEKDAYS[index] ?? "";
}

/**
 * The date `months` calendar months after `from`. When that month has no such day (29, 30 or 31),
 * the last day of the month is used: 29 February becomes 28 February in a year that is not a leap
 * year, and 31 January plus one month is the end of February.
 */
export function addMonths(from: Ymd, months: number): Ymd {
  const index = from.y * 12 + (from.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return { y, m, d: Math.min(from.d, daysInMonth(y, m)) };
}

const before = (a: Ymd, b: Ymd) => toDayNumber(a) < toDayNumber(b);

function label(field: "birth" | "on"): string {
  return field === "birth" ? "birth date" : "age-on date";
}

function readDate(text: string, field: "birth" | "on"): Ymd | Result {
  if (text.trim() === "") {
    return { ok: false, field, error: `Choose the ${label(field)}.` };
  }
  const date = parseDate(text);
  if (!date) {
    return {
      ok: false,
      field,
      error: `The ${label(field)} is not a real date. Use the form YYYY-MM-DD, with a year from ${MIN_YEAR} to ${MAX_YEAR}.`,
    };
  }
  return date;
}

/** The exact age on a date, or what is wrong with the dates. */
export function run(input: Input): Result {
  const birth = readDate(input.birth, "birth");
  if (!("y" in birth)) return birth;
  const on = readDate(input.on, "on");
  if (!("y" in on)) return on;

  if (before(on, birth)) {
    return {
      ok: false,
      field: "birth",
      error: `The birth date (${formatDate(birth)}) is after the age-on date (${formatDate(on)}), so there is no age to show yet.`,
    };
  }

  let months = (on.y - birth.y) * 12 + (on.m - birth.m);
  if (before(on, addMonths(birth, months))) months -= 1;
  const days = toDayNumber(on) - toDayNumber(addMonths(birth, months));

  let year = on.y;
  let birthday = addMonths({ ...birth, y: year }, 0);
  if (before(birthday, on)) {
    year += 1;
    birthday = addMonths({ ...birth, y: year }, 0);
  }
  return {
    ok: true,
    years: Math.floor(months / 12),
    months: months % 12,
    days,
    totalDays: toDayNumber(on) - toDayNumber(birth),
    next: {
      text: `${weekdayName(birthday)}, ${formatDate(birthday)}`,
      daysUntil: toDayNumber(birthday) - toDayNumber(on),
      turns: year - birth.y,
    },
  };
}
