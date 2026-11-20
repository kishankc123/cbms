import { guardView } from "@/components/page-guard";
import { can, requireTenantSession } from "@/lib/session";
import { monthNames, todayIso, ymdOf } from "@/lib/calendar";
import { PageHeader } from "@/components/ui/page-header";
import { loadAttendanceMonth } from "@/lib/payroll/attendance";
import { AttendanceSheet } from "./attendance-sheet";

// Attendance of a payroll month, for everyone at once (it can still be marked from an employee's own profile). Months open on the organization's calendar;
// a month that hasn't started can't be opened, and neither can a day that hasn't come.
export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ y?: string; m?: string }> }) {
  const denied = await guardView("payroll");
  if (denied) return denied;
  const session = await requireTenantSession();
  const calendar = session.calendar;
  const today = todayIso();
  const now = ymdOf(calendar, today) ?? ymdOf("AD", today)!;

  const q = await searchParams;
  let year = Number(q.y) || now.year;
  let month = Number(q.m) || now.month;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || year > now.year || (year === now.year && month > now.month)) {
    year = now.year;
    month = now.month;
  }

  let data;
  try {
    data = await loadAttendanceMonth(session.tenantId, calendar, year, month);
  } catch {
    year = now.year;
    month = now.month;
    data = await loadAttendanceMonth(session.tenantId, calendar, year, month);
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Attendance" description="Mark who was absent, on leave or on a half day. Everyone else counts as present." className="!mb-0" />
      <AttendanceSheet data={data} monthName={monthNames(calendar)[month - 1]} today={today} current={now} canEdit={can(session, "payroll", "edit")} />
    </div>
  );
}
