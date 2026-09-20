// Bikram Sambat month lengths come from the `nepali-date-converter` package's
// published table — we deliberately keep no calendar data of our own, so
// upgrading that package (kept current by Dependabot, see
// .github/dependabot.yml) is how the calendar stays up to date.
//
// Only the data table is imported (not the whole library) to keep the browser
// bundle small.
import { dateConfigMap } from "nepali-date-converter/dist/lib/date-config";

export const BS_MONTH_KEYS = ["Baisakh", "Jestha", "Asar", "Shrawan", "Bhadra", "Aswin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"] as const;

// BS 2000-01-01 falls on AD 1943-04-14 (confirmed against every library we
// cross-check in calendar.test.ts).
const ANCHOR_UTC = Date.UTC(1943, 3, 14);
const DAY_MS = 86_400_000;

const years = Object.keys(dateConfigMap)
  .map(Number)
  .sort((a, b) => a - b);

export const BS_MIN_YEAR = years[0];
export const BS_MAX_YEAR = years[years.length - 1];

/**
 * Last BS year whose month lengths every independent source we test against
 * agrees on. Later years exist in the library but are projections and may be
 * revised, so entering/converting them is flagged. calendar.test.ts fails if
 * this constant drifts from reality after a library update.
 */
export const VERIFIED_THROUGH_BS_YEAR = 2083;

// monthLengths[yearIndex][monthIndex]
const monthLengths: number[][] = years.map((y) => BS_MONTH_KEYS.map((k) => (dateConfigMap as Record<string, Record<string, number>>)[String(y)][k]));

// yearStartDay[yearIndex] = days from anchor to Baisakh 1 of that year
const yearStartDay: number[] = [];
{
  let acc = 0;
  for (const row of monthLengths) {
    yearStartDay.push(acc);
    acc += row.reduce((s, n) => s + n, 0);
  }
  yearStartDay.push(acc);
}
const TOTAL_DAYS = yearStartDay[yearStartDay.length - 1];

export function bsDaysInMonth(year: number, month: number): number | null {
  const yi = year - BS_MIN_YEAR;
  if (yi < 0 || yi >= monthLengths.length || month < 1 || month > 12) return null;
  return monthLengths[yi][month - 1];
}

export function bsDaysInYear(year: number): number | null {
  const yi = year - BS_MIN_YEAR;
  return yi < 0 || yi >= monthLengths.length ? null : yearStartDay[yi + 1] - yearStartDay[yi];
}

/** Days since the anchor for a UTC-midnight AD timestamp, or null if outside the BS table. */
function offsetFromUtc(utcMs: number): number | null {
  const off = Math.round((utcMs - ANCHOR_UTC) / DAY_MS);
  return off < 0 || off >= TOTAL_DAYS ? null : off;
}

export function adUtcToBs(utcMs: number): { year: number; month: number; day: number } | null {
  let off = offsetFromUtc(utcMs);
  if (off === null) return null;

  let yi = 0;
  let lo = 0;
  let hi = monthLengths.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (yearStartDay[mid] <= off) {
      yi = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  off -= yearStartDay[yi];
  const row = monthLengths[yi];
  let mi = 0;
  while (off >= row[mi]) {
    off -= row[mi];
    mi++;
  }
  return { year: BS_MIN_YEAR + yi, month: mi + 1, day: off + 1 };
}

export function bsToAdUtc(year: number, month: number, day: number): number | null {
  const dim = bsDaysInMonth(year, month);
  if (dim === null || !Number.isInteger(day) || day < 1 || day > dim) return null;
  const yi = year - BS_MIN_YEAR;
  let off = yearStartDay[yi];
  for (let m = 0; m < month - 1; m++) off += monthLengths[yi][m];
  off += day - 1;
  return ANCHOR_UTC + off * DAY_MS;
}

export const BS_RANGE_START_UTC = ANCHOR_UTC;
export const BS_RANGE_END_UTC = ANCHOR_UTC + (TOTAL_DAYS - 1) * DAY_MS;
