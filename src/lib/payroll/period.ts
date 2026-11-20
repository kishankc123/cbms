import { daysInMonth as calendarDaysInMonth, isoFromYmd, type CalendarSystem } from "@/lib/calendar";

// The days a payroll month covers: a month of the organization's calendar, narrowed to the payroll start and end days of its settings.
// Attendance is kept for the same days, so what is marked is what payroll reads.

export function periodForMonth(calendar: CalendarSystem, year: number, month: number, startDay: number, endDay: number) {
  const lastDay = calendarDaysInMonth(calendar, year, month);
  if (!lastDay) throw new Error("That month is outside the supported calendar range");
  const start = Math.min(Math.max(startDay, 1), lastDay);
  const end = Math.min(Math.max(endDay, start), lastDay);
  const periodStart = isoFromYmd(calendar, { year, month, day: start });
  const periodEnd = isoFromYmd(calendar, { year, month, day: end });
  if (!periodStart || !periodEnd) throw new Error("Invalid payroll month");
  return { periodStart, periodEnd };
}

export function eachDate(startStr: string, endStr: string) {
  const dates: string[] = [];
  const cur = new Date(startStr + "T00:00:00Z");
  const end = new Date(endStr + "T00:00:00Z");
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}
