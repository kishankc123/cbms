import { guardView, guardSalary } from "@/components/page-guard";
import { can, requireTenantSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { monthNames, todayIso, ymdOf } from "@/lib/calendar";
import { listHeadings, listRounds } from "@/lib/payroll/incentives";
import { IncentivesWorkspace } from "./incentives-workspace";

// Performance incentives: publish a heading and how often it is paid, then each period open a round and choose who gets what.
export default async function IncentivesPage() {
  const denied = (await guardView("payroll")) ?? (await guardSalary());
  if (denied) return denied;
  const session = await requireTenantSession();
  const [headings, rounds] = await Promise.all([listHeadings(session.tenantId), listRounds(session.tenantId)]);
  const now = ymdOf(session.calendar, todayIso());

  return (
    <div className="space-y-4">
      <PageHeader title="Performance incentives" description="Headings you pay incentives under, and each period's round of who gets what. Approved rounds go into the salary sheet." className="!mb-0" />
      <IncentivesWorkspace
        headings={headings.map((h) => ({ id: h.id, name: h.name, frequency: h.frequency, taxable: h.taxable, countsForRetirement: h.countsForRetirement, isActive: h.isActive }))}
        rounds={rounds.map((r) => ({ id: r.id, headingId: r.headingId, headingName: r.headingName, periodLabel: r.periodLabel, status: r.status, year: r.year, month: r.month, calendarSystem: r.calendarSystem, people: r.people, total: r.total }))}
        calendar={session.calendar}
        monthNames={monthNames(session.calendar)}
        thisYear={now?.year ?? new Date().getFullYear()}
        thisMonth={now?.month ?? new Date().getMonth() + 1}
        canCreate={can(session, "payroll", "create")}
        canEdit={can(session, "payroll", "edit")}
        canDelete={can(session, "payroll", "delete")}
      />
    </div>
  );
}
