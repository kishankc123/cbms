import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { customers, journalLines, vendors } from "@/db/schema";
import { getCashBankAccounts } from "./cash-bank-accounts";

// Which transactions a report may open in its pop-up. Each report is allowed by its own module, and may only open the entries it
// is about: a customer statement opens entries that touch a customer receivable account, a supplier statement ones that touch a
// supplier payable account, the Cash and Bank books ones that touch a cash or bank account. The Ledger, Journal Report and
// Transaction Register (chart of accounts) may open any. Plain server helper; the action checks the permission first.

export type EntryScope = "ledger" | "bank" | "sales" | "purchases";

export const SCOPE_MODULE: Record<EntryScope, string> = { ledger: "chart_of_accounts", bank: "bank_reconciliation", sales: "sales", purchases: "purchases" };

async function touches(entryId: string, accountIds: string[]): Promise<boolean> {
  if (accountIds.length === 0) return false;
  const [hit] = await db
    .select({ id: journalLines.id })
    .from(journalLines)
    .where(and(eq(journalLines.journalEntryId, entryId), inArray(journalLines.accountId, accountIds)))
    .limit(1);
  return Boolean(hit);
}

export async function entryInScope(tenantId: string, entryId: string, scope: EntryScope): Promise<boolean> {
  switch (scope) {
    case "ledger":
      return true;
    case "bank":
      return touches(entryId, (await getCashBankAccounts(tenantId)).flatMap((g) => [g.id, ...g.children.map((c) => c.id)]));
    case "sales":
      return touches(entryId, (await db.select({ id: customers.receivableAccountId }).from(customers).where(eq(customers.tenantId, tenantId))).map((r) => r.id).filter((x): x is string => Boolean(x)));
    case "purchases":
      return touches(entryId, (await db.select({ id: vendors.payableAccountId }).from(vendors).where(eq(vendors.tenantId, tenantId))).map((r) => r.id).filter((x): x is string => Boolean(x)));
  }
}
