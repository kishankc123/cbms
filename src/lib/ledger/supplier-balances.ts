import { eq } from "drizzle-orm";
import { db } from "@/db";
import { vendors } from "@/db/schema";
import { buildStatement, getPartyLines, type PartyLine } from "./party-ledger";

/**
 * Every supplier's ledger lines, from their own payable sub-account — bills, payments, the opening
 * balance and any manual journal voucher posted to it. Suppliers are credit-normal.
 */
export async function getSupplierLines(tenantId: string): Promise<Map<string, PartyLine[]>> {
  const list = await db.select({ id: vendors.id, accountId: vendors.payableAccountId }).from(vendors).where(eq(vendors.tenantId, tenantId));
  const linesByAccount = await getPartyLines(tenantId, list.map((v) => v.accountId).filter((x): x is string => Boolean(x)));
  return new Map(list.map((v) => [v.id, v.accountId ? linesByAccount.get(v.accountId) ?? [] : []]));
}

/** Each supplier's current balance (positive = we owe them), read from the ledger. */
export async function getSupplierBalances(tenantId: string): Promise<Record<string, number>> {
  const lines = await getSupplierLines(tenantId);
  return Object.fromEntries([...lines].map(([id, l]) => [id, buildStatement(l, "credit").closingBalance]));
}
