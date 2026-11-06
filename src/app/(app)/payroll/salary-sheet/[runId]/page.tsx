import { guardView, guardSalary } from "@/components/page-guard";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollRuns, payrollLines, employees } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { RunStatusControls } from "./run-status-controls";

import { D } from "@/components/calendar/date-text";
import { payrollPeriodLabel } from "@/lib/payroll/period-label";
import { getRunRecoveryBreakdown } from "@/lib/payroll/staff-advances";
import type { TdsWorking } from "@/lib/payroll/salary-tax-calc";
import { TdsCell } from "../../tds-working";
import Link from "next/link";
import { StatStrip } from "@/components/ui/stat-strip";

export default async function PayrollRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const denied = (await guardView("payroll")) ?? (await guardSalary());
  if (denied) return denied;
  const { runId } = await params;
  const session = await requireTenantSession();

  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.tenantId, session.tenantId)))
    .limit(1);
  if (!run) return <p className="text-sm text-red-600">Payroll run not found.</p>;

  const lines = await db
    .select({
      id: payrollLines.id,
      employeeCode: employees.employeeCode,
      fullName: employees.fullName,
      basicSalary: payrollLines.basicSalary,
      workingDays: payrollLines.workingDays,
      presentDays: payrollLines.presentDays,
      absentDays: payrollLines.absentDays,
      proratedBasic: payrollLines.proratedBasic,
      allowances: payrollLines.allowances,
      employeeId: payrollLines.employeeId,
      deductions: payrollLines.deductions,
      advanceRecovered: payrollLines.advanceRecovered,
      benefitsAmount: payrollLines.benefitsAmount,
      grossPay: payrollLines.grossPay,
      tdsAmount: payrollLines.tdsAmount,
      tdsDetail: payrollLines.tdsDetail,
      netPay: payrollLines.netPay,
      employeeRetirement: payrollLines.employeeRetirement,
      employerRetirement: payrollLines.employerRetirement,
      retirementDetail: payrollLines.retirementDetail,
    })
    .from(payrollLines)
    .innerJoin(employees, eq(employees.id, payrollLines.employeeId))
    .where(eq(payrollLines.payrollRunId, runId));

  const sum = (f: (l: (typeof lines)[number]) => number) => Math.round(lines.reduce((s, l) => s + f(l), 0) * 100) / 100;
  const totalNet = sum((l) => Number(l.netPay));
  const totalGross = sum((l) => Number(l.grossPay));
  const totalTds = sum((l) => Number(l.tdsAmount));
  const totalEmployerRetirement = sum((l) => Number(l.employerRetirement));
  const totalEmployeeDeductions = sum((l) => Number(l.deductions) + Number(l.employeeRetirement) + Number(l.tdsAmount) + Number(l.advanceRecovered));
  // Why a contribution was not taken (no registration number, no rules published, a CIT ceiling), kept on the line when the run was calculated.
  const retirementNotes = lines.flatMap((l) => ((l.retirementDetail as { warnings?: string[] } | null)?.warnings ?? []).map((w) => `${l.fullName}: ${w}`));
  const unverifiedRules = lines.some((l) => (l.retirementDetail as { rulesVerified?: boolean | null } | null)?.rulesVerified === false);
  const workingOf = (l: (typeof lines)[number]) => (l.tdsDetail as TdsWorking | null) ?? null;
  const slabsMissing = lines.some((l) => workingOf(l)?.missing === "slabs");
  const assumedStatus = lines.filter((l) => workingOf(l)?.classAssumed).length;
  const hasAdvances = lines.some((l) => Number(l.advanceRecovered) > 0);
  const recoveries = hasAdvances ? await getRunRecoveryBreakdown(session.tenantId, run) : [];
  const nameOf = new Map(lines.map((l) => [l.employeeId, l.fullName]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink">
            {payrollPeriodLabel(run)}
          </h1>
          <p className="text-sm text-gray-500">
            <D value={run.periodStart} /> – <D value={run.periodEnd} />
          </p>
        </div>
        <RunStatusControls runId={run.id} status={run.status} month={run.month} year={run.year} calendar={run.calendarSystem === "BS" ? "BS" : "AD"} slabsMissing={slabsMissing} />
      </div>

      {slabsMissing && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">Salary-tax slabs are not set for this fiscal year, so no TDS was taken in this run. Once the platform administrator has published them, recalculate the run.</p>}
      {assumedStatus > 0 && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{assumedStatus} employee{assumedStatus === 1 ? " has" : "s have"} no tax status, so the Single slabs were used. Choose Single or Couple on the employee&apos;s profile, then recalculate.</p>}

      {unverifiedRules && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">The retirement contribution rates used in this run have not been confirmed against current law yet. Check them with your platform administrator before relying on it.</p>}
      {retirementNotes.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">Retirement contributions to check:</p>
          <ul className="list-disc pl-5">
            {retirementNotes.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <StatStrip
        items={[
          { label: "Employees", value: lines.length },
          { label: "Gross salary", value: totalGross.toFixed(2) },
          { label: "Employee deductions", value: totalEmployeeDeductions.toFixed(2) },
          { label: "Remuneration tax", value: totalTds.toFixed(2) },
          { label: "Net salary payable", value: totalNet.toFixed(2) },
          { label: "Employer contributions", value: totalEmployerRetirement.toFixed(2) },
          { label: "Employer payroll cost", value: (totalGross + totalEmployerRetirement).toFixed(2) },
        ]}
      />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
            <tr>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Employee</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Basic Salary</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Working Days</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Present</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Absent</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Prorated Basic</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Allowances</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Benefits</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Deductions</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Gross Pay</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">SSF / PF / CIT</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">TDS</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Advance Recovered</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Net Pay</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Employer contribution</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-line transition-colors hover:bg-hover">
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="font-mono text-xs text-gray-500">{l.employeeCode}</span> {l.fullName}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{Number(l.basicSalary).toFixed(2)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{Number(l.workingDays).toFixed(2)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{Number(l.presentDays).toFixed(2)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{Number(l.absentDays).toFixed(2)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{Number(l.proratedBasic).toFixed(2)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{Number(l.allowances).toFixed(2)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{Number(l.benefitsAmount).toFixed(2)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{Number(l.deductions).toFixed(2)}</td>
                <td className="px-3 py-2 whitespace-nowrap font-medium">{Number(l.grossPay).toFixed(2)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{Number(l.employeeRetirement).toFixed(2)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <TdsCell amount={Number(l.tdsAmount)} working={workingOf(l)} title={l.fullName} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{Number(l.advanceRecovered).toFixed(2)}</td>
                <td className="px-3 py-2 whitespace-nowrap font-medium">{Number(l.netPay).toFixed(2)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-ink-2">{Number(l.employerRetirement).toFixed(2)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-right">
                  <Link href={`/payroll/payslips/${l.id}`} className="text-xs text-accent hover:underline">
                    Payslip
                  </Link>
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={16} className="px-4 py-6 text-center text-gray-400">
                  No lines in this run
                </td>
              </tr>
            )}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-medium">
                <td colSpan={13} className="px-3 py-2 text-right">
                  Total Net Pay
                </td>
                <td className="px-3 py-2">{totalNet.toFixed(2)}</td>
                <td className="px-3 py-2 text-ink-2">{totalEmployerRetirement.toFixed(2)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {recoveries.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Staff advances {run.status === "finalized" ? "recovered in" : "to be recovered in"} this run</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
              <tr>
                <th className="py-1 pr-3 font-medium">Employee</th>
                <th className="py-1 pr-3 font-medium">Advance date</th>
                <th className="py-1 pr-3 font-medium">Taken against</th>
                <th className="py-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {recoveries.map((r, i) => (
                <tr key={i} className="border-b border-line transition-colors hover:bg-hover">
                  <td className="py-1 pr-3">{nameOf.get(r.employeeId)}</td>
                  <td className="py-1 pr-3"><D value={r.advanceDate} /></td>
                  <td className="py-1 pr-3">{payrollPeriodLabel({ calendarSystem: r.forCalendar, month: r.forMonth, year: r.forYear })}</td>
                  <td className="py-1 text-right">{r.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}    </div>
  );
}
