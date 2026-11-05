import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, employeeRetirement, employees, journalEntries, journalLines, payments, payrollLines, payrollRuns } from "@/db/schema";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { getAccountByRole } from "@/lib/compliance/tax-accounts";
import { payrollTdsHeadKey } from "@/lib/ledger/tds-payable-accounts";
import { getEmployeePayableBalance } from "./accrual";
import { payrollPeriodLabel } from "./period-label";
import { FUNDS, retirementBalances } from "./contributions";
import { RETIREMENT_ACCOUNTS } from "./retirement-pay";
import type { ReportLine } from "./payroll-reports";
import type { RetirementLine } from "./retirement-pay";
import type { TdsWorking } from "./salary-tax-calc";

// What the payroll reports read. Only FINALIZED runs count: a draft is not yet a figure anyone owes or has been paid.

const n = (v: string | number | null) => Number(v ?? 0);

export async function loadReportLines(tenantId: string, range: { from: string; to: string }, employeeId?: string): Promise<ReportLine[]> {
  const rows = await db
    .select({ line: payrollLines, run: payrollRuns, employee: employees })
    .from(payrollLines)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.payrollRunId))
    .innerJoin(employees, eq(employees.id, payrollLines.employeeId))
    .where(
      and(
        eq(payrollLines.tenantId, tenantId),
        eq(payrollRuns.tenantId, tenantId),
        eq(employees.tenantId, tenantId),
        eq(payrollRuns.status, "finalized"),
        gte(payrollRuns.periodEnd, range.from),
        lte(payrollRuns.periodEnd, range.to),
        ...(employeeId ? [eq(payrollLines.employeeId, employeeId)] : [])
      )
    );
  return rows.map(({ line, run, employee }) => ({
    runId: run.id,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    period: payrollPeriodLabel(run),
    employeeId: employee.id,
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    panNumber: employee.panNumber,
    basic: n(line.proratedBasic),
    gross: n(line.grossPay),
    taxablePay: n(line.taxablePay ?? line.grossPay),
    tds: n(line.tdsAmount),
    advance: n(line.advanceRecovered),
    otherDeductions: n(line.deductions),
    employeeRetirement: n(line.employeeRetirement),
    employerRetirement: n(line.employerRetirement),
    retirement: ((line.retirementDetail as { lines?: RetirementLine[] } | null)?.lines ?? []) as RetirementLine[],
    tdsDetail: (line.tdsDetail as TdsWorking | null) ?? null,
    net: n(line.netPay),
  }));
}

/** Registration numbers by "employeeId:scheme" (the latest enrolment's), for the contribution reports. */
export async function loadRegistrations(tenantId: string): Promise<Map<string, string>> {
  const rows = await db.select().from(employeeRetirement).where(eq(employeeRetirement.tenantId, tenantId)).orderBy(desc(employeeRetirement.startDate));
  const out = new Map<string, string>();
  for (const r of rows) {
    const key = `${r.employeeId}:${r.scheme}`;
    if (!out.has(key) && r.registrationNumber) out.set(key, r.registrationNumber);
  }
  return out;
}

/** Salary paid out per employee in a range (salary payments that are not voided). */
export async function loadSalaryPaid(tenantId: string, range: { from: string; to: string }): Promise<Map<string, number>> {
  const rows = await db
    .select({ employeeId: payments.employeeId, total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
    .from(payments)
    .where(and(eq(payments.tenantId, tenantId), eq(payments.paymentType, "salary_payment"), eq(payments.status, "posted"), gte(payments.paymentDate, range.from), lte(payments.paymentDate, range.to)))
    .groupBy(payments.employeeId);
  return new Map(rows.filter((r) => r.employeeId).map((r) => [r.employeeId as string, Number(r.total)]));
}

export async function loadOwedNow(tenantId: string, employeeIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const id of employeeIds) out.set(id, await getEmployeePayableBalance(tenantId, id));
  return out;
}

async function creditBalance(tenantId: string, accountIds: string[]) {
  if (accountIds.length === 0) return 0;
  const [row] = await db
    .select({ v: sql<string>`coalesce(sum(${journalLines.creditAmount} - ${journalLines.debitAmount}), 0)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.accountId, accountIds)));
  return Math.round(Number(row.v) * 100) / 100;
}

/** What payroll owes today: employees' salary, the tax office (salary TDS) and each retirement fund account. */
export async function loadLiabilities(tenantId: string): Promise<{ label: string; amount: number }[]> {
  const items: { label: string; amount: number }[] = [];
  const group = await findControlAccount(tenantId, ["2300"], "Salary Payable");
  const children = group ? await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.parentAccountId, group.id))) : [];
  items.push({ label: "Employees: net salary payable", amount: await creditBalance(tenantId, children.map((c) => c.id)) });
  const head = await payrollTdsHeadKey(tenantId);
  const tds = head ? await getAccountByRole(tenantId, `tds_payable:${head}`) : null;
  items.push({ label: "Tax office: remuneration tax (TDS) withheld", amount: tds ? await creditBalance(tenantId, [tds.id]) : 0 });
  const balances = await retirementBalances(tenantId);
  for (const f of FUNDS) for (const a of f.accounts) items.push({ label: `${f.key.toUpperCase()}: ${RETIREMENT_ACCOUNTS[a]}`, amount: balances[a].owed });
  return items;
}
