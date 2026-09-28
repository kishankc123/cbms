import Link from "next/link";
import { requireTenantSession, can } from "@/lib/session";
import { payrollSummary } from "@/lib/payroll/payroll-summary";
import { presetRange, todayIso, validateADDate } from "@/lib/calendar";
import { getFiscalRange } from "@/lib/fiscal";
import { D } from "@/components/calendar/date-text";
import { ReportFilter } from "@/components/calendar/report-filter";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);
const fmt = (n: number) => n.toFixed(2);

export default async function PayrollSummaryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const dflt = presetRange("this_fiscal_year", session.calendar, todayIso(), fiscal);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;

  const { runs } = await payrollSummary(session.tenantId, new Date(from + "T00:00:00Z"), new Date(to + "T00:00:00Z"));

  const totals = runs.reduce(
    (acc, r) => ({
      employeeCount: acc.employeeCount + r.employeeCount,
      grossPay: acc.grossPay + r.grossPay,
      allowances: acc.allowances + r.allowances,
      deductions: acc.deductions + r.deductions,
      overtimeAmount: acc.overtimeAmount + r.overtimeAmount,
      benefitsAmount: acc.benefitsAmount + r.benefitsAmount,
      advanceRecovered: acc.advanceRecovered + r.advanceRecovered,
      netPay: acc.netPay + r.netPay,
    }),
    { employeeCount: 0, grossPay: 0, allowances: 0, deductions: 0, overtimeAmount: 0, benefitsAmount: 0, advanceRecovered: 0, netPay: 0 }
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Payroll Summary</h1>
        <Link href="/reports" className="text-sm text-[var(--color-primary)] hover:underline">
          ← Reports
        </Link>
      </div>
      <ReportFilter from={from} to={to} fiscal={fiscal} />
      <p className="text-sm text-gray-500">
        <D value={from} /> – <D value={to} />
      </p>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Payroll Run</th>
            <th className="px-4 py-2 font-medium text-right">Employees</th>
            <th className="px-4 py-2 font-medium text-right">Gross Pay</th>
            <th className="px-4 py-2 font-medium text-right">Allowances</th>
            <th className="px-4 py-2 font-medium text-right">Overtime</th>
            <th className="px-4 py-2 font-medium text-right">Benefits</th>
            <th className="px-4 py-2 font-medium text-right">Deductions</th>
            <th className="px-4 py-2 font-medium text-right">Advance Recovered</th>
            <th className="px-4 py-2 font-medium text-right">Net Pay</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.runId} className="border-t border-gray-100">
              <td className="px-4 py-2">{r.label}</td>
              <td className="px-4 py-2 text-right">{r.employeeCount}</td>
              <td className="px-4 py-2 text-right">{fmt(r.grossPay)}</td>
              <td className="px-4 py-2 text-right">{fmt(r.allowances)}</td>
              <td className="px-4 py-2 text-right">{fmt(r.overtimeAmount)}</td>
              <td className="px-4 py-2 text-right">{fmt(r.benefitsAmount)}</td>
              <td className="px-4 py-2 text-right">{fmt(r.deductions)}</td>
              <td className="px-4 py-2 text-right">{fmt(r.advanceRecovered)}</td>
              <td className="px-4 py-2 text-right font-medium">{fmt(r.netPay)}</td>
              <td className="px-4 py-2 whitespace-nowrap">
                <Link href={`/payroll/salary-sheet/${r.runId}`} className="text-xs text-[var(--color-primary)] hover:underline">
                  Open in Salary Sheet
                </Link>
              </td>
            </tr>
          ))}
          {runs.length === 0 && (
            <tr>
              <td colSpan={10} className="px-4 py-6 text-center text-gray-400">
                No finalized payroll runs in this period
              </td>
            </tr>
          )}
        </tbody>
        {runs.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <td className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right">{totals.employeeCount}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.grossPay)}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.allowances)}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.overtimeAmount)}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.benefitsAmount)}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.deductions)}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.advanceRecovered)}</td>
              <td className="px-4 py-2 text-right">{fmt(totals.netPay)}</td>
              <td className="px-4 py-2"></td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
