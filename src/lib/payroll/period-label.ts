import { monthNames, type CalendarSystem } from "@/lib/calendar";

/** "Ashwin 2083" / "September 2026" — a payroll run's month in the calendar it was created under. */
export function payrollPeriodLabel(run: { calendarSystem?: string | null; month: number; year: number }): string {
  const cal: CalendarSystem = run.calendarSystem === "BS" ? "BS" : "AD";
  return `${monthNames(cal)[run.month - 1]} ${run.year}`;
}
