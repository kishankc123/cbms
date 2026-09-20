import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { buildStatement, getPartyLines, type PartyLine } from "./party-ledger";

/**
 * Every customer's ledger lines, from their own receivable sub-account — invoices, receipts, the
 * opening balance and any manual journal voucher posted to it. Customers are debit-normal.
 */
export async function getCustomerLines(tenantId: string): Promise<Map<string, PartyLine[]>> {
  const list = await db.select({ id: customers.id, accountId: customers.receivableAccountId }).from(customers).where(eq(customers.tenantId, tenantId));
  const linesByAccount = await getPartyLines(tenantId, list.map((c) => c.accountId).filter((x): x is string => Boolean(x)));
  return new Map(list.map((c) => [c.id, c.accountId ? linesByAccount.get(c.accountId) ?? [] : []]));
}

/** Each customer's current balance, read from the ledger (so it always agrees with the Chart of Accounts). */
export async function getCustomerBalances(tenantId: string): Promise<Record<string, number>> {
  const lines = await getCustomerLines(tenantId);
  return Object.fromEntries([...lines].map(([id, l]) => [id, buildStatement(l, "debit").closingBalance]));
}
