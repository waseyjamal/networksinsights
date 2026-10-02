// Pure logic of Date Difference Calculator: the time between two calendar dates in years, months
// and days, the total days, the weeks and the weekdays (Monday to Friday). Dates are plain calendar
// dates in the proleptic Gregorian calendar; no time zone or clock is involved.
//
// The dates covered run from the earlier date up to, but not including, the later date. With
// "include the end date" the later date is counted too, which adds one day to every measure.

export const MIN_YEAR = 1;
export const MAX_YEAR = 9999;

/** What the tool accepts, as `YYYY-MM-DD` text. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  start: string;
  end: string;
  includeEnd: boolean;
}

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export type Result =
  | {
      ok: true;
      years: number;
      months: number;
      days: number;
      /** The number of dates covered. */
      totalDays: number;
      /** Whole weeks in the total days, and the days left over. */
      weeks: number;
      extraDays: number;
      /** How many of the dates covered fall on a Monday to Friday. */
      weekdays: number;
      /** True when the end date was before the start date, so the two were put in order. */
      swapped: boolean;
    }
  | { ok: false; field: "start" | "end"; error: string };

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

/**
 * The date `months` calendar months after `from`. When that month has no such day (29, 30 or 31),
 * the last day of the month is used.
 */
export function addMonths(from: Ymd, months: number): Ymd {
  const index = from.y * 12 + (from.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return { y, m, d: Math.min(from.d, daysInMonth(y, m)) };
}

/** The date `days` after `from`. */
export function addDays(from: Ymd, days: number): Ymd {
  // Walk a month at a time, which keeps this free of any date type.
  let { y, m, d } = from;
  let left = days;
  while (left > 0) {
    const room = daysInMonth(y, m) - d;
    if (left <= room) {
      d += left;
      left = 0;
    } else {
      left -= room + 1;
      d = 1;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
  return { y, m, d };
}

/** 0 for Sunday to 6 for Saturday. 1970-01-01 was a Thursday. */
function weekdayOf(dayNumber: number): number {
  return (((dayNumber + 4) % 7) + 7) % 7;
}

/** How many of the `count` days from `first` (a day number) fall on a Monday to Friday. */
export function countWeekdays(first: number, count: number): number {
  let total = Math.floor(count / 7) * 5;
  for (let i = 0; i < count % 7; i += 1) {
    const day = weekdayOf(first + i);
    if (day >= 1 && day <= 5) total += 1;
  }
  return total;
}

const FIELD_NAMES = { start: "start date", end: "end date" } as const;

function readDate(text: string, field: "start" | "end"): Ymd | Result {
  if (text.trim() === "") {
    return { ok: false, field, error: `Choose the ${FIELD_NAMES[field]}.` };
  }
  const date = parseDate(text);
  if (!date) {
    return {
      ok: false,
      field,
      error: `The ${FIELD_NAMES[field]} is not a real date. Use the form YYYY-MM-DD, with a year from ${MIN_YEAR} to ${MAX_YEAR}.`,
    };
  }
  return date;
}

/** The difference between two dates, or what is wrong with them. */
export function run(input: Input): Result {
  const first = readDate(input.start, "start");
  if (!("y" in first)) return first;
  const second = readDate(input.end, "end");
  if (!("y" in second)) return second;

  const swapped = toDayNumber(second) < toDayNumber(first);
  const from = swapped ? second : first;
  const last = swapped ? first : second;
  const to = input.includeEnd ? addDays(last, 1) : last;

  let months = (to.y - from.y) * 12 + (to.m - from.m);
  if (toDayNumber(to) < toDayNumber(addMonths(from, months))) months -= 1;
  const days = toDayNumber(to) - toDayNumber(addMonths(from, months));
  const totalDays = toDayNumber(to) - toDayNumber(from);

  return {
    ok: true,
    years: Math.floor(months / 12),
    months: months % 12,
    days,
    totalDays,
    weeks: Math.floor(totalDays / 7),
    extraDays: totalDays % 7,
    weekdays: countWeekdays(toDayNumber(from), totalDays),
    swapped,
  };
}
