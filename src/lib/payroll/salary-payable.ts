import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { buildStatement, getPartyLines } from "@/lib/ledger/party-ledger";

const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

export type SalaryPayableRow = { employeeId: string; accountId: string | null; employeeName: string; balance: number };

/**
 * What's currently owed to each employee, read from their own Salary Payable sub-account — the same
 * party-ledger machinery (getPartyLines/buildStatement) getSupplierBalances() uses, just credit-normal
 * against each employee's payableAccountId instead of a vendor's.
 */
export async function salaryPayable(tenantId: string, asOf: Date): Promise<SalaryPayableRow[]> {
  const asOfStr = toDateStr(asOf);
  const employeeRows = await db.select({ id: employees.id, name: employees.fullName, accountId: employees.payableAccountId }).from(employees).where(eq(employees.tenantId, tenantId));

  const accountIds = employeeRows.map((e) => e.accountId).filter((x): x is string => Boolean(x));
  const linesByAccount = await getPartyLines(tenantId, accountIds);

  return employeeRows
    .map((e) => {
      const lines = e.accountId ? (linesByAccount.get(e.accountId) ?? []) : [];
      const balance = buildStatement(lines, "credit", { to: asOfStr }).closingBalance;
      return { employeeId: e.id, accountId: e.accountId, employeeName: e.name, balance };
    })
    .filter((r) => r.balance !== 0)
    .sort((a, b) => b.balance - a.balance);
}
