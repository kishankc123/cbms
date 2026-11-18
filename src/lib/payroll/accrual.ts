import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, journalEntries, journalLines, payrollLines, type payrollRuns } from "@/db/schema";
import { postJournalEntry, type PostLineInput } from "@/lib/ledger/post";
import { getOrCreateEmployeeAdvanceAccountId } from "@/lib/ledger/advance-accounts";
import { getOrCreateSalaryExpenseAccount, getSalaryPartAccounts, getOrCreateIncentiveHeadingAccount, getOrCreatePayrollDeductionsAccount, getOrCreateSalaryTdsPayableAccount, createEmployeePayableAccount } from "@/lib/ledger/payroll-accounts";
import { getOrCreateTdsHeadPayableAccount, payrollTdsHeadKey } from "@/lib/ledger/tds-payable-accounts";
import { payrollPeriodLabel } from "@/lib/payroll/period-label";
import { getOrCreateEmployerRetirementExpense, getOrCreateRetirementPayable } from "@/lib/ledger/retirement-accounts";
import { creditsFor, RETIREMENT_ACCOUNTS, type RetirementAccountKey, type RetirementLine } from "@/lib/payroll/retirement-pay";

type Run = typeof payrollRuns.$inferSelect;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The salary entries currently in force for a run (neither one that has been reversed, nor a reversal entry itself). */
export async function activePayrollEntries(tenantId: string, runId: string) {
  return db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceType, "payroll"), eq(journalEntries.sourceId, runId), eq(journalEntries.isReversed, false), isNull(journalEntries.reversalOfId)));
}

/**
 * Posts the ledger accrual for a finalized run: every employee's own Salary Payable sub-account is credited with
 * their net pay, Salary Expense is debited with gross pay, deductions withheld go to Payroll Deductions Payable, and any staff
 * advance recovered from the pay clears the employee's Staff Advance account, and the salary TDS withheld goes to TDS Payable — Salary
 * (gross = net + deductions + advance recovered + TDS + the employee's retirement contribution).
 * Retirement contributions (only for employees in a scheme): the employee's share is credited to the matching payable account, and the
 * employer's share is debited to Employer Retirement Contributions and credited to its payable account (the employer's gratuity has an account
 * of its own). One entry covers the whole run, so a run is never posted twice.
 * Returns the entry's id. It refuses to post twice for the same run, and refuses when there is nothing to post (so a
 * run can never be finalized with no accounting behind it).
 */
export async function postPayrollAccrual(tenantId: string, run: Run, userId: string): Promise<string> {
  if ((await activePayrollEntries(tenantId, run.id)).length > 0) throw new Error("This payroll run has already been posted to the ledger");

  const lines = await db
    .select({ employeeId: payrollLines.employeeId, grossPay: payrollLines.grossPay, allowances: payrollLines.allowances, benefitsAmount: payrollLines.benefitsAmount, incentivesDetail: payrollLines.incentivesDetail, deductions: payrollLines.deductions, netPay: payrollLines.netPay, advanceRecovered: payrollLines.advanceRecovered, tdsAmount: payrollLines.tdsAmount, employeeRetirement: payrollLines.employeeRetirement, employerRetirement: payrollLines.employerRetirement, retirementDetail: payrollLines.retirementDetail })
    .from(payrollLines)
    .where(eq(payrollLines.payrollRunId, run.id));
  if (lines.length === 0) throw new Error("This payroll run has no employee lines — generate it first");

  const employeeRows = await db
    .select({ id: employees.id, fullName: employees.fullName, payableAccountId: employees.payableAccountId })
    .from(employees)
    .where(eq(employees.tenantId, tenantId));
  const employeeById = new Map(employeeRows.map((e) => [e.id, e]));

  // Gross pay is posted across Salaries' three parts: basic salary, allowances (components and benefits) and each performance incentive heading.
  const salaryExpense = await getOrCreateSalaryExpenseAccount(tenantId);
  const parts = await getSalaryPartAccounts(tenantId);
  const headingAccounts = new Map<string, string>();
  const totalDeductions = lines.reduce((s, l) => s + Number(l.deductions), 0);
  const deductionsAccount = totalDeductions > 0 ? await getOrCreatePayrollDeductionsAccount(tenantId) : null;
  const totalTds = lines.reduce((s, l) => s + Number(l.tdsAmount), 0);
  const payrollHead = totalTds > 0 ? await payrollTdsHeadKey(tenantId) : null;
  const tdsAccount = totalTds > 0 ? (payrollHead ? await getOrCreateTdsHeadPayableAccount(tenantId, payrollHead) : await getOrCreateSalaryTdsPayableAccount(tenantId)) : null;

  const postLines: PostLineInput[] = [];
  const retirementLines: RetirementLine[] = [];
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
    const advance = Number(line.advanceRecovered);
    const tds = Number(line.tdsAmount);
    if (gross <= 0) continue;
    retirementLines.push(...(((line.retirementDetail as { lines?: RetirementLine[] } | null)?.lines ?? []) as RetirementLine[]));

    const incentives = ((line.incentivesDetail ?? []) as { headingId: string; name: string; amount: number }[]).filter((i) => i.amount > 0);
    const allowancePart = round2(Number(line.allowances) + Number(line.benefitsAmount));
    const incentivePart = round2(incentives.reduce((sum, i) => sum + i.amount, 0));
    const basicPart = round2(gross - allowancePart - incentivePart);
    if (basicPart < 0) {
      // Figures that don't add up (should not happen): post the whole of it to Salaries rather than refuse.
      postLines.push({ accountId: salaryExpense.id, debitAmount: gross, description: `Salary expense - ${employee.fullName}` });
    } else {
      if (basicPart > 0) postLines.push({ accountId: parts.basic.id, debitAmount: basicPart, description: `Basic salary - ${employee.fullName}` });
      if (allowancePart > 0) postLines.push({ accountId: parts.allowances.id, debitAmount: allowancePart, description: `Allowances - ${employee.fullName}` });
      for (const i of incentives) {
        let accountId = headingAccounts.get(i.headingId);
        if (!accountId) {
          accountId = (await getOrCreateIncentiveHeadingAccount(tenantId, i.headingId, i.name)).id;
          headingAccounts.set(i.headingId, accountId);
        }
        postLines.push({ accountId, debitAmount: round2(i.amount), description: `${i.name} - ${employee.fullName}` });
      }
    }
    if (net > 0) postLines.push({ accountId: payableAccountId, creditAmount: net, description: `Salary payable - ${employee.fullName}` });
    if (advance > 0) postLines.push({ accountId: await getOrCreateEmployeeAdvanceAccountId(tenantId, employee.id), creditAmount: advance, description: `Staff advance recovered - ${employee.fullName}` });
    if (tds > 0 && tdsAccount) postLines.push({ accountId: tdsAccount.id, creditAmount: tds, description: `Salary TDS - ${employee.fullName}` });
    if (deductions > 0 && deductionsAccount) postLines.push({ accountId: deductionsAccount.id, creditAmount: deductions, description: `Payroll deductions - ${employee.fullName}` });
  }
  if (postLines.length === 0) throw new Error("Nobody has any pay in this run, so there is nothing to post");

  // Retirement contributions: what was taken from employees, and what the employer owes on top, by account.
  const credits = creditsFor(retirementLines);
  const employerCost = Math.round(retirementLines.reduce((sum, l) => sum + l.employer, 0) * 100) / 100;
  if (employerCost > 0) postLines.push({ accountId: (await getOrCreateEmployerRetirementExpense(tenantId)).id, debitAmount: employerCost, description: "Employer retirement contributions" });
  for (const key of Object.keys(credits) as RetirementAccountKey[]) {
    const amount = credits[key] ?? 0;
    if (amount > 0) postLines.push({ accountId: (await getOrCreateRetirementPayable(tenantId, key)).id, creditAmount: amount, description: RETIREMENT_ACCOUNTS[key] });
  }

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
