import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollRuns, payrollLines, employees } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { RunStatusControls } from "./run-status-controls";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function PayrollRunPage({ params }: { params: Promise<{ runId: string }> }) {
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
      deductions: payrollLines.deductions,
      benefitsAmount: payrollLines.benefitsAmount,
      grossPay: payrollLines.grossPay,
      netPay: payrollLines.netPay,
    })
    .from(payrollLines)
    .innerJoin(employees, eq(employees.id, payrollLines.employeeId))
    .where(eq(payrollLines.payrollRunId, runId));

  const totalNet = lines.reduce((s, l) => s + Number(l.netPay), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {MONTH_NAMES[run.month - 1]} {run.year}
          </h1>
          <p className="text-sm text-gray-500">
            {run.periodStart} – {run.periodEnd}
          </p>
        </div>
        <RunStatusControls runId={run.id} status={run.status} month={run.month} year={run.year} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
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
              <th className="px-3 py-2 font-medium whitespace-nowrap">Net Pay</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-gray-100">
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
                <td className="px-3 py-2 whitespace-nowrap font-medium">{Number(l.netPay).toFixed(2)}</td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-gray-400">
                  No lines in this run
                </td>
              </tr>
            )}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-medium">
                <td colSpan={10} className="px-3 py-2 text-right">
                  Total Net Pay
                </td>
                <td className="px-3 py-2">{totalNet.toFixed(2)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
