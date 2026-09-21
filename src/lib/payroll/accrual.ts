import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, journalEntries, journalLines, payrollLines, type payrollRuns } from "@/db/schema";
import { postJournalEntry, type PostLineInput } from "@/lib/ledger/post";
import { getOrCreateSalaryExpenseAccount, getOrCreatePayrollDeductionsAccount, createEmployeePayableAccount } from "@/lib/ledger/payroll-accounts";
import { payrollPeriodLabel } from "@/lib/payroll/period-label";

type Run = typeof payrollRuns.$inferSelect;

/** The salary entries currently in force for a run (neither one that has been reversed, nor a reversal entry itself). */
export async function activePayrollEntries(tenantId: string, runId: string) {
  return db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceType, "payroll"), eq(journalEntries.sourceId, runId), eq(journalEntries.isReversed, false), isNull(journalEntries.reversalOfId)));
}

/**
 * Posts the ledger accrual for a finalized run: every employee's own Salary Payable sub-account is credited with
 * their net pay, Salary Expense is debited with gross pay, and deductions withheld go to Payroll Deductions Payable.
 * Returns the entry's id. It refuses to post twice for the same run, and refuses when there is nothing to post (so a
 * run can never be finalized with no accounting behind it).
 */
export async function postPayrollAccrual(tenantId: string, run: Run, userId: string): Promise<string> {
  if ((await activePayrollEntries(tenantId, run.id)).length > 0) throw new Error("This payroll run has already been posted to the ledger");

  const lines = await db
    .select({ employeeId: payrollLines.employeeId, grossPay: payrollLines.grossPay, deductions: payrollLines.deductions, netPay: payrollLines.netPay })
    .from(payrollLines)
    .where(eq(payrollLines.payrollRunId, run.id));
  if (lines.length === 0) throw new Error("This payroll run has no employee lines — generate it first");

  const employeeRows = await db
    .select({ id: employees.id, fullName: employees.fullName, payableAccountId: employees.payableAccountId })
    .from(employees)
    .where(eq(employees.tenantId, tenantId));
  const employeeById = new Map(employeeRows.map((e) => [e.id, e]));

  const salaryExpense = await getOrCreateSalaryExpenseAccount(tenantId);
  const totalDeductions = lines.reduce((s, l) => s + Number(l.deductions), 0);
  const deductionsAccount = totalDeductions > 0 ? await getOrCreatePayrollDeductionsAccount(tenantId) : null;

  const postLines: PostLineInput[] = [];
  for (const line of lines) {
    const employee = employeeById.get(line.employeeId);
    if (!employee) continue;

    let payableAccountId = employee.payableAccountId;
    if (!payableAccountId) {
      payableAccountId = (await createEmployeePayableAccount(tenantId, employee.fullName)).id;
      await db.update(employees).set({ payableAccountId }).where(eq(employees.id, employee.id));
    }

    const gross = Number(line.grossPay);
    const deductions = Number(line.deductions);
    const net = Number(line.netPay);
    if (gross <= 0) continue;

    postLines.push({ accountId: salaryExpense.id, debitAmount: gross, description: `Salary expense - ${employee.fullName}` });
    if (net > 0) postLines.push({ accountId: payableAccountId, creditAmount: net, description: `Salary payable - ${employee.fullName}` });
    if (deductions > 0 && deductionsAccount) postLines.push({ accountId: deductionsAccount.id, creditAmount: deductions, description: `Payroll deductions - ${employee.fullName}` });
  }
  if (postLines.length === 0) throw new Error("Nobody has any pay in this run, so there is nothing to post");

  const entry = await postJournalEntry({
    tenantId,
    entryDate: run.periodEnd,
    sourceType: "payroll",
    sourceId: run.id,
    referenceNumber: `PR-${run.calendarSystem === "BS" ? "BS-" : ""}${run.year}-${String(run.month).padStart(2, "0")}`,
    memo: `Payroll for ${payrollPeriodLabel(run)}`,
    createdBy: userId,
    lines: postLines,
  });
  return entry.id;
}

/** What an employee is owed and hasn't been paid: the credit balance of their own Salary Payable account. */
export async function getEmployeePayableBalance(tenantId: string, employeeId: string): Promise<number> {
  const [e] = await db.select({ a: employees.payableAccountId }).from(employees).where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId))).limit(1);
  if (!e?.a) return 0;
  const [row] = await db
    .select({ v: sql<string>`coalesce(sum(${journalLines.creditAmount} - ${journalLines.debitAmount}), 0)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalLines.accountId, e.a)));
  return Math.round(Number(row.v) * 100) / 100 + 0;
}
