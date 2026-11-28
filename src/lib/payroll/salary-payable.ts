import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { buildStatement, getPartyLines } from "@/lib/ledger/party-ledger";
import { staffAccountIds } from "./staff-account";

const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

export type SalaryPayableRow = { employeeId: string; accountId: string | null; employeeName: string; balance: number };

/**
 * What's currently owed to each employee, read from their staff account — the same party-ledger machinery (getPartyLines/buildStatement) getSupplierBalances()
 * uses, credit-normal. A minus balance is an employee who owes the company (an advance not yet recovered, or an overpayment).
 */
export async function salaryPayable(tenantId: string, asOf: Date): Promise<SalaryPayableRow[]> {
  const asOfStr = toDateStr(asOf);
  const employeeRows = await db.select({ id: employees.id, name: employees.fullName, payableAccountId: employees.payableAccountId, advanceAccountId: employees.advanceAccountId }).from(employees).where(eq(employees.tenantId, tenantId));

  const linesByAccount = await getPartyLines(tenantId, employeeRows.flatMap(staffAccountIds));

  return employeeRows
    .map((e) => {
      const lines = staffAccountIds(e).flatMap((id) => linesByAccount.get(id) ?? []);
      const balance = buildStatement(lines, "credit", { to: asOfStr }).closingBalance;
      return { employeeId: e.id, accountId: e.payableAccountId, employeeName: e.name, balance };
    })
    .filter((r) => r.balance !== 0)
    .sort((a, b) => b.balance - a.balance);
}
