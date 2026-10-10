import { requireTenantSession, can } from "@/lib/session";
import { salaryPayable } from "@/lib/payroll/salary-payable";
import { validateADDate } from "@/lib/calendar";
import { getFiscalRange, getReportDefaultAsOf } from "@/lib/fiscal";
import { D } from "@/components/calendar/date-text";
import { ReportFilter } from "@/components/calendar/report-filter";
import { SalaryPayableView } from "./salary-payable-view";
import { BackButton } from "@/components/ui/back-button";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

export default async function SalaryPayablePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "view") || !can(session, "payroll", "view_salary")) throw new Error("Not permitted");
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const to = asIso(sp.to) ?? (await getReportDefaultAsOf(session.tenantId));

  const rows = await salaryPayable(session.tenantId, new Date(to + "T00:00:00Z"));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BackButton href="/reports" label="Back to Reports" />
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Salary Payable</h1>
      </div>
      <ReportFilter from={to} to={to} fiscal={fiscal} asOfOnly />
      <p className="text-sm text-gray-500">
        As of <D value={to} />
      </p>
      <SalaryPayableView rows={rows} asOf={to} />
    </div>
  );
}
