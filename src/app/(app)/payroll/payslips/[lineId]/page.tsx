import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { guardView, guardSalary } from "@/components/page-guard";
import { db } from "@/db";
import { employees, payrollLines, payrollRuns, tenants } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { D } from "@/components/calendar/date-text";
import { payrollPeriodLabel } from "@/lib/payroll/period-label";
import type { TdsWorking } from "@/lib/payroll/salary-tax-calc";
import type { RetirementLine } from "@/lib/payroll/retirement-pay";
import type { ComponentLine } from "@/lib/payroll/components";
import { PrintButton } from "./print-button";

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// One employee's payslip for one payroll run: company, employee, period, earnings, deductions, net pay, and the employer's contributions shown
// separately (they are not taken from the employee). It prints cleanly, so Save as PDF from the print dialog gives the PDF.
export default async function PayslipPage({ params }: { params: Promise<{ lineId: string }> }) {
  const denied = (await guardView("payroll")) ?? (await guardSalary());
  if (denied) return denied;
  const { lineId } = await params;
  const session = await requireTenantSession();

  const [row] = await db
    .select({ line: payrollLines, run: payrollRuns, employee: employees })
    .from(payrollLines)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.payrollRunId))
    .innerJoin(employees, eq(employees.id, payrollLines.employeeId))
    .where(and(eq(payrollLines.id, lineId), eq(payrollLines.tenantId, session.tenantId), eq(payrollRuns.tenantId, session.tenantId), eq(employees.tenantId, session.tenantId)))
    .limit(1);
  if (!row) return <p className="text-sm text-red-600">Payslip not found.</p>;
  const { line, run, employee } = row;
  const [company] = await db.select({ name: tenants.companyName, address: tenants.address, phone: tenants.phone, email: tenants.email, pan: tenants.panVatNumber }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);

  const n = (v: string | number | null) => Number(v ?? 0);
  const components = ((line.componentsDetail as ComponentLine[] | null) ?? []).filter((c) => c.amount !== 0);
  const allowanceLines = components.filter((c) => c.type === "allowance");
  const deductionComponents = components.filter((c) => c.type === "deduction");
  // Older payslips were made before components were itemized: show the total instead.
  const allowancesShown = line.componentsDetail ? allowanceLines : n(line.allowances) > 0 ? [{ name: "Allowances", amount: n(line.allowances) }] : [];
  const deductionsShown = line.componentsDetail ? deductionComponents : n(line.deductions) > 0 ? [{ name: "Other deductions", amount: n(line.deductions) }] : [];
  const retirement = ((line.retirementDetail as { lines?: RetirementLine[] } | null)?.lines ?? []) as RetirementLine[];
  const working = (line.tdsDetail as TdsWorking | null) ?? null;

  const employeeRetirement = n(line.employeeRetirement);
  const employerRetirement = n(line.employerRetirement);
  const totalDeductions = Math.round((n(line.deductions) + employeeRetirement + n(line.tdsAmount) + n(line.advanceRecovered)) * 100) / 100;
  const earnings: { label: string; amount: number }[] = [
    { label: "Basic salary", amount: n(line.proratedBasic) },
    ...allowancesShown.map((a) => ({ label: a.name, amount: a.amount })),
    ...(n(line.benefitsAmount) > 0 ? [{ label: "Benefits", amount: n(line.benefitsAmount) }] : []),
  ];
  const deductionRows: { label: string; amount: number }[] = [
    ...retirement.filter((r) => r.employee > 0).map((r) => ({ label: r.scheme === "cit" ? "CIT contribution" : `${r.scheme.toUpperCase()} - ${r.label}`, amount: r.employee })),
    ...(n(line.tdsAmount) > 0 ? [{ label: "Remuneration tax (TDS)", amount: n(line.tdsAmount) }] : []),
    ...deductionsShown.map((d) => ({ label: d.name, amount: d.amount })),
    ...(n(line.advanceRecovered) > 0 ? [{ label: "Staff advance recovered", amount: n(line.advanceRecovered) }] : []),
  ];

  const info = (label: string, value: string | null | undefined) => (
    <div className="flex justify-between gap-3 py-0.5 text-[13px]">
      <span className="text-ink-2">{label}</span>
      <span className="text-right text-ink">{value || "—"}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/payroll/employees/${employee.id}`} className="text-sm text-accent hover:underline">
          ← Back to {employee.fullName}
        </Link>
        <PrintButton />
      </div>
      {run.status !== "finalized" && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 print:hidden">This payroll run is not finalized yet, so this payslip can still change.</p>}

      <article id="payslip" className="mx-auto max-w-3xl space-y-5 rounded-lg border border-line bg-surface p-6 text-ink">
        <header className="flex items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <h1 className="text-lg font-semibold">{company?.name}</h1>
            <p className="text-[13px] text-ink-2">{[company?.address, company?.phone, company?.email].filter(Boolean).join(" · ")}</p>
            {company?.pan && <p className="text-[13px] text-ink-2">PAN/VAT: {company.pan}</p>}
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold">Payslip</p>
            <p className="text-[13px] text-ink-2">{payrollPeriodLabel(run)}</p>
            <p className="text-xs text-ink-2">
              <D value={run.periodStart} /> – <D value={run.periodEnd} />
            </p>
          </div>
        </header>

        <section className="grid gap-x-8 sm:grid-cols-2">
          <div>
            {info("Employee", employee.fullName)}
            {info("Employee ID", employee.employeeCode)}
            {info("Designation", employee.designation)}
            {info("Department", employee.department)}
          </div>
          <div>
            {info("PAN", employee.panNumber)}
            {info("Bank", [employee.bankName, employee.bankAccountNumber].filter(Boolean).join(" · "))}
            {info("Days worked", `${n(line.presentDays)} of ${n(line.workingDays)}`)}
            {info("Joined", employee.joiningDate)}
          </div>
        </section>

        <section className="grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="mb-1 border-b border-line pb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">Earnings</h2>
            {earnings.map((e) => (
              <div key={e.label} className="flex justify-between py-0.5 text-[13px]">
                <span>{e.label}</span>
                <span className="tabular-nums">{money(e.amount)}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-line pt-1 text-[13px] font-semibold">
              <span>Gross salary</span>
              <span className="tabular-nums">{money(n(line.grossPay))}</span>
            </div>
          </div>
          <div>
            <h2 className="mb-1 border-b border-line pb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">Deductions</h2>
            {deductionRows.length === 0 && <p className="py-0.5 text-[13px] text-ink-2">None</p>}
            {deductionRows.map((d) => (
              <div key={d.label} className="flex justify-between py-0.5 text-[13px]">
                <span>{d.label}</span>
                <span className="tabular-nums">{money(d.amount)}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-line pt-1 text-[13px] font-semibold">
              <span>Total deductions</span>
              <span className="tabular-nums">{money(totalDeductions)}</span>
            </div>
          </div>
        </section>

        <div className="flex items-center justify-between rounded bg-app px-4 py-3">
          <span className="text-sm font-semibold">Net salary</span>
          <span className="text-lg font-semibold tabular-nums">{money(n(line.netPay))}</span>
        </div>

        {employerRetirement > 0 && (
          <section>
            <h2 className="mb-1 border-b border-line pb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">Employer contributions (paid by the employer, not deducted from you)</h2>
            {retirement.filter((r) => r.employer > 0).map((r, i) => (
              <div key={i} className="flex justify-between py-0.5 text-[13px]">
                <span>{r.scheme === "cit" ? "CIT" : `${r.scheme.toUpperCase()} - ${r.label}`}</span>
                <span className="tabular-nums">{money(r.employer)}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-line pt-1 text-[13px] font-semibold">
              <span>Total employer contributions</span>
              <span className="tabular-nums">{money(employerRetirement)}</span>
            </div>
          </section>
        )}

        {working && working.annualTax !== undefined && working.missing === null && (
          <section className="text-xs text-ink-2">
            <p>
              Tax for the year is worked out on projected income of {money(working.projected)}
              {working.retirementDeduction ? `, less ${money(working.retirementDeduction)} saved in retirement schemes` : ""}, giving {money(working.annualTax)}
              {working.sstExemption ? ` after the first-band exemption of ${money(working.sstExemption)}` : ""}. {money(working.withheldBefore + working.priorTds)} was already withheld, and the rest is spread over the {working.monthsLeft} month{working.monthsLeft === 1 ? "" : "s"} left.
            </p>
          </section>
        )}
      </article>

      <style>{`@media print { body * { visibility: hidden; } #payslip, #payslip * { visibility: visible; } #payslip { position: absolute; left: 0; top: 0; width: 100%; max-width: none; border: none; } }`}</style>
    </div>
  );
}
