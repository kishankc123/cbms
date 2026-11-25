import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, journalEntries, journalLines } from "@/db/schema";
import { netPosition } from "./net-position";

/** Every employee's net position in one pass, for the list: positive means the company owes the employee, negative that the employee holds more advance than salary owed. */
export async function employeeBalances(tenantId: string): Promise<Record<string, number>> {
  const people = await db.select({ id: employees.id, payable: employees.payableAccountId, advance: employees.advanceAccountId }).from(employees).where(eq(employees.tenantId, tenantId));
  const accountIds = people.flatMap((p) => [p.payable, p.advance]).filter((a): a is string => Boolean(a));
  const rows =
    accountIds.length === 0
      ? []
      : await db
          .select({ accountId: journalLines.accountId, net: sql<string>`coalesce(sum(${journalLines.debitAmount} - ${journalLines.creditAmount}), 0)` })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
          .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.accountId, accountIds)))
          .groupBy(journalLines.accountId);
  const debitMinusCredit = new Map(rows.map((r) => [r.accountId, Number(r.net)]));
  const out: Record<string, number> = {};
  for (const p of people) {
    const owed = p.payable ? -(debitMinusCredit.get(p.payable) ?? 0) : 0; // a liability: credit minus debit
    const held = p.advance ? (debitMinusCredit.get(p.advance) ?? 0) : 0; // an asset: debit minus credit
    const n = netPosition(owed, held);
    out[p.id] = n.side === "company_owes" ? n.amount : n.side === "employee_owes" ? -n.amount : 0;
  }
  return out;
}
