// Marking attendance: which days can be marked, and what a month adds up to. Pure, so it is unit-tested. A day nobody marked counts as present: only the
// exceptions (absent, leave, half day) are kept, and payroll reads them the same way.

export type AttendanceStatus = "present" | "absent" | "leave" | "half_day";

/** What a tap on a day does: absent, then leave, then half day, then back to present. */
export const NEXT_STATUS: Record<AttendanceStatus, AttendanceStatus> = { present: "absent", absent: "leave", leave: "half_day", half_day: "present" };

export type DayState = "open" | "before_joining" | "after_leaving" | "future";

/** Whether a day can be marked for someone: not before they joined, not after they left, and not a day that has not come yet. */
export function dayState(employee: { joiningDate: string; leavingDate: string | null }, date: string, today: string): DayState {
  if (date < employee.joiningDate) return "before_joining";
  if (employee.leavingDate && date > employee.leavingDate) return "after_leaving";
  if (date > today) return "future";
  return "open";
}

/** The reason a day can't be marked, in words, or null when it can. */
export function markProblem(employee: { fullName: string; joiningDate: string; leavingDate: string | null }, date: string, today: string): string | null {
  switch (dayState(employee, date, today)) {
    case "before_joining":
      return `${employee.fullName} had not joined on that day (joined ${employee.joiningDate}), so it can't be marked.`;
    case "after_leaving":
      return `${employee.fullName} had left by that day (last day ${employee.leavingDate}), so it can't be marked.`;
    case "future":
      return "Attendance can't be marked for a day that hasn't come yet.";
    default:
      return null;
  }
}

export type MonthTotals = { present: number; absent: number; leave: number; half: number };

/** What one person's month adds up to over the days that could be marked, leaving out holidays. A half day is counted on its own, not as present or absent. */
export function monthTotals(employee: { joiningDate: string; leavingDate: string | null }, dates: readonly string[], records: Readonly<Record<string, AttendanceStatus>>, holidays: ReadonlySet<string>, today: string): MonthTotals {
  const t: MonthTotals = { present: 0, absent: 0, leave: 0, half: 0 };
  for (const d of dates) {
    if (holidays.has(d) || dayState(employee, d, today) !== "open") continue;
    const s = records[d] ?? "present";
    if (s === "present") t.present++;
    else if (s === "absent") t.absent++;
    else if (s === "leave") t.leave++;
    else t.half++;
  }
  return t;
}
