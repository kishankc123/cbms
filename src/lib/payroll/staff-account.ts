import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, journalEntries, journalLines } from "@/db/schema";
import { createEmployeePayableAccount } from "@/lib/ledger/payroll-accounts";

// Each employee has ONE staff account (under Staff accounts, current liabilities). Salary earned is credited to it; advances and salary payments are debited. Its
// balance says either what the company owes the employee or what the employee owes the company.
//
// Employees from before this had a second account for advances (employees.advanceAccountId). Nothing posts there any more, and its history is moved onto the staff
// account by merge-staff-accounts.ts. Balances and statements always add the two together, so they are right both before and after that move.

const round2 = (n: number) => Math.round(n * 100) / 100 + 0;

/** The accounts that make up an employee's staff account. */
export function staffAccountIds(employee: { payableAccountId: string | null; advanceAccountId: string | null }): string[] {
  return [...new Set([employee.payableAccountId, employee.advanceAccountId].filter((a): a is string => Boolean(a)))];
}

/** The account new salary, advances and salary payments post to, made on first use. */
export async function getOrCreateStaffAccountId(tenantId: string, employeeId: string): Promise<string> {
  const [e] = await db.select({ id: employees.id, fullName: employees.fullName, payableAccountId: employees.payableAccountId }).from(employees).where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId))).limit(1);
  if (!e) throw new Error("Employee not found");
  if (e.payableAccountId) return e.payableAccountId;
  const id = (await createEmployeePayableAccount(tenantId, e.fullName)).id;
  await db.update(employees).set({ payableAccountId: id }).where(and(eq(employees.id, e.id), eq(employees.tenantId, tenantId)));
  return id;
}

/** Every employee's staff account balance: positive means the company owes the employee, negative that the employee owes the company. */
export async function staffBalances(tenantId: string, employeeIds?: string[]): Promise<Map<string, number>> {
  if (employeeIds && employeeIds.length === 0) return new Map();
  const people = await db
    .select({ id: employees.id, payableAccountId: employees.payableAccountId, advanceAccountId: employees.advanceAccountId })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), ...(employeeIds ? [inArray(employees.id, employeeIds)] : [])));
  const accountIds = people.flatMap(staffAccountIds);
  const rows =
    accountIds.length === 0
      ? []
      : await db
          .select({ accountId: journalLines.accountId, v: sql<string>`coalesce(sum(${journalLines.creditAmount} - ${journalLines.debitAmount}), 0)` })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
          .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.accountId, accountIds)))
          .groupBy(journalLines.accountId);
  const byAccount = new Map(rows.map((r) => [r.accountId, Number(r.v)]));
  return new Map(people.map((p) => [p.id, round2(staffAccountIds(p).reduce((s, a) => s + (byAccount.get(a) ?? 0), 0))]));
}

/** One employee's staff account balance (see staffBalances). */
export async function getStaffBalance(tenantId: string, employeeId: string): Promise<number> {
  return (await staffBalances(tenantId, [employeeId])).get(employeeId) ?? 0;
}
