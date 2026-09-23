"use client";

import { formatDate, formatDateTime, formatPeriodRange, todayIso, type CalendarSystem, type DateStyle, type IsoDate } from "@/lib/calendar";
import { useCalendar } from "./calendar-provider";

/**
 * Shows a stored (AD ISO) date in the organization's calendar. Use this — or
 * `useFormatDate` / `formatDate` — for every date on screen; never print the
 * raw stored string. Usable from server and client components.
 *
 * `calendar` forces one calendar (for the AD/BS columns of ledgers and reports).
 */
export function D({ value, style = "numeric", calendar }: { value: string | null | undefined; style?: DateStyle; calendar?: CalendarSystem }) {
  const orgCalendar = useCalendar();
  return <>{formatDate(value, calendar ?? orgCalendar, style)}</>;
}

/**
 * Shows a compliance period (start..end, AD ISO) in the organization's own calendar —
 * never in whatever calendar it was generated under (compliance is always computed in
 * the country's statutory calendar; only the display adapts). `fallback` is the stored
 * label, used when start/end aren't available.
 */
export function PeriodLabel({ start, end, fallback }: { start: IsoDate | null | undefined; end: IsoDate | null | undefined; fallback: string }) {
  const calendar = useCalendar();
  return <>{formatPeriodRange(calendar, start, end, fallback)}</>;
}

/**
 * Shows a system timestamp (created/posted/audit time) in Nepal time, with the
 * date in the organization's calendar. `dateOnly` drops the clock time.
 */
export function DT({ value, dateOnly }: { value: Date | string | null | undefined; dateOnly?: boolean }) {
  const calendar = useCalendar();
  if (!value) return <>—</>;
  const d = typeof value === "string" ? new Date(value) : value;
  return <>{dateOnly ? formatDate(todayIso(d), calendar) : formatDateTime(d, calendar)}</>;
}
