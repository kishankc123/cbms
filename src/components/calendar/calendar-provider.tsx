"use client";

import { createContext, useContext } from "react";
import { formatDate, formatDateTime, type CalendarSystem, type DateStyle } from "@/lib/calendar";

const CalendarContext = createContext<CalendarSystem>("AD");

// Makes the organization's calendar available to every client component
// beneath it (set once in the app layout from the organization setting).
export function CalendarProvider({ calendar, children }: { calendar: CalendarSystem; children: React.ReactNode }) {
  return <CalendarContext.Provider value={calendar}>{children}</CalendarContext.Provider>;
}

export const useCalendar = () => useContext(CalendarContext);

/** Same, for system timestamps (shown in Nepal time). */
export function useFormatDateTime() {
  const calendar = useCalendar();
  return (value: Date | string | null | undefined) => formatDateTime(value, calendar);
}

/** Formatter bound to the organization's calendar, for client code that builds strings. */
export function useFormatDate() {
  const calendar = useCalendar();
  return (iso: string | null | undefined, style: DateStyle = "numeric") => formatDate(iso, calendar, style);
}
