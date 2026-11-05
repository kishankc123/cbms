import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { guardView, guardSalary } from "@/components/page-guard";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db";
import { employees, tenants } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { todayIso } from "@/lib/calendar";
import { fiscalYearsFor } from "@/lib/compliance/platform-tax-rates";
import { TdsDepositTables } from "@/components/compliance/tds-deposit-tables";
import { tdsDepositPosition } from "@/lib/compliance/tds-deposits";
import { payrollTdsHeadKey } from "@/lib/ledger/tds-payable-accounts";
import { tdsDepositReport, annualReconciliation, annualTaxSummary, contributionReport, employerExpenseReport, liabilityReport, monthlyTdsReport, netSalaryPaymentReport, REPORTS, type ReportKey, type ReportTable } from "@/lib/payroll/payroll-reports";
import { loadLiabilities, loadOwedNow, loadRegistrations, loadReportLines, loadSalaryPaid } from "@/lib/payroll/payroll-report-data";
import { ReportActions, ReportFilters } from "./report-controls";

const money = (v: string | number) => (typeof v === "number" ? v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v);

// The payroll reports, built from finalized payroll runs. The monthly salary sheet and the payroll summary live where they always did; the rest are here.
export default async function PayrollReportsPage({ searchParams }: { searchParams: Promise<{ report?: string; fy?: string; from?: string; to?: string; employee?: string }> }) {
  const denied = (await guardView("payroll")) ?? (await guardSalary());
  if (denied) return denied;
  const q = await searchParams;
  const session = await requireTenantSession();
  const key: ReportKey = (REPORTS.find((r) => r.key === q.report && !("external" in r))?.key as ReportKey | undefined) ?? "ssf";
  const today = todayIso();

  const [tenant] = await db.select({ countryCode: tenants.countryCode }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const years = (await fiscalYearsFor(tenant?.countryCode ?? "", today)).filter((y) => y.from <= today);
  const current = years.find((y) => y.from <= today && today <= y.to) ?? years[years.length - 1];
  const chosen = years.find((y) => String(y.startYear) === q.fy);
  // A custom range wins over a fiscal year; with neither, the current fiscal year.
  const from = q.from || (q.to ? "0000-01-01" : (chosen ?? current)?.from ?? "0000-01-01");
  const to = q.to || (q.from ? "9999-12-31" : (chosen ?? current)?.to ?? "9999-12-31");
  const fy = q.from || q.to ? "" : String((chosen ?? current)?.startYear ?? "");
  const employeeList = await db.select({ id: employees.id, code: employees.employeeCode, name: employees.fullName }).from(employees).where(eq(employees.tenantId, session.tenantId)).orderBy(asc(employees.employeeCode));
  const employeeId = employeeList.some((e) => e.id === q.employee) ? q.employee : undefined;

  const range = { from, to };
  let table: ReportTable;
  if (key === "liability") {
    table = liabilityReport(await loadLiabilities(session.tenantId));
  } else {
    const lines = await loadReportLines(session.tenantId, range, employeeId);
    if (key === "ssf" || key === "pf" || key === "cit") table = contributionReport(key, lines, await loadRegistrations(session.tenantId));
    else if (key === "tds") table = monthlyTdsReport(lines);
    else if (key === "annual") table = annualTaxSummary(lines);
    else if (key === "reconciliation") table = annualReconciliation(lines);
    else if (key === "employer") table = employerExpenseReport(lines);
    else {
      const ids = [...new Set(lines.map((l) => l.employeeId))];
      table = netSalaryPaymentReport(lines, await loadSalaryPaid(session.tenantId, range), await loadOwedNow(session.tenantId, ids));
    }
  }
  // The monthly tax report also shows what has been deposited, by deposit period, for the salary heading.
  const salaryHead = key === "tds" ? await payrollTdsHeadKey(session.tenantId) : null;
  const deposits = key === "tds" && salaryHead ? await tdsDepositPosition(session.tenantId, from, to, salaryHead) : null;
  const title = REPORTS.find((r) => r.key === key)?.label ?? "Payroll report";
  const rangeText = key === "liability" ? `As of ${today}` : `${from === "0000-01-01" ? "Start" : from} to ${to === "9999-12-31" ? "today" : to}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Payroll reports" className="!mb-0 print:hidden" />
      <div className="flex flex-wrap gap-1.5 print:hidden">
        {REPORTS.map((r) =>
          "external" in r ? (
            <Link key={r.key} href={r.href} className="rounded-full bg-surface-2 px-3 py-1 text-[13px] text-ink-2 hover:text-ink">
              {r.label} ↗
            </Link>
          ) : (
            <Link key={r.key} href={`/payroll/reports?report=${r.key}${fy ? `&fy=${fy}` : ""}${q.from ? `&from=${q.from}` : ""}${q.to ? `&to=${q.to}` : ""}${employeeId ? `&employee=${employeeId}` : ""}`} className={`rounded-full px-3 py-1 text-[13px] ${r.key === key ? "bg-accent text-[var(--on-accent)]" : "bg-surface-2 text-ink-2 hover:text-ink"}`}>
              {r.label}
            </Link>
          )
        )}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <ReportFilters years={years.map((y) => ({ startYear: y.startYear, label: y.label }))} employees={employeeList.map((e) => ({ id: e.id, name: `${e.code} ${e.name}` }))} current={{ report: key, fy, from: q.from ?? "", to: q.to ?? "", employee: employeeId ?? "" }} usesRange={key !== "liability"} />
        <ReportActions table={table} title={title} filename={`payroll-${key}-${today}`} extra={deposits ? { title: "Salary tax deposits", table: tdsDepositReport(deposits.rows) } : undefined} />
      </div>

      <style>{`@media print { body * { visibility: hidden; } #payroll-report, #payroll-report * { visibility: visible; } #payroll-report { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
      <section id="payroll-report" className="space-y-4">
        {deposits && <TdsDepositTables position={deposits} title="Salary tax withheld and deposited" />}
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <p className="text-xs text-ink-2">{rangeText}{employeeId ? ` · ${employeeList.find((e) => e.id === employeeId)?.name}` : ""} · finalized payroll runs only</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
              <tr>
                {table.columns.map((c) => (
                  <th key={c.key} className={`px-2.5 py-1.5 font-medium ${c.numeric ? "text-right" : ""}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-b border-line transition-colors hover:bg-hover">
                  {table.columns.map((c) => (
                    <td key={c.key} className={`px-2.5 py-1.5 ${c.numeric ? "text-right tabular-nums" : ""}`}>
                      {c.numeric ? money(r[c.key]) : r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={table.columns.length} className="px-4 py-6 text-center text-ink-3">
                    Nothing to show for this range. Reports use finalized payroll runs.
                  </td>
                </tr>
              )}
            </tbody>
            {table.totals && (
              <tfoot>
                <tr className="border-t border-line bg-app font-medium">
                  {table.columns.map((c) => (
                    <td key={c.key} className={`px-2.5 py-1.5 ${c.numeric ? "text-right tabular-nums" : ""}`}>
                      {table.totals?.[c.key] === undefined ? "" : c.numeric ? money(table.totals[c.key]) : table.totals[c.key]}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {table.note && <p className="text-xs text-ink-2">{table.note}</p>}
      </section>
    </div>
  );
}
