import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { accounts, items, journalEntries, journalLines } from "@/db/schema";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What the ledger says Inventory holds: the Inventory account (1200) and anything nested under it, debits less credits. */
export async function getInventoryLedgerBalance(tenantId: string): Promise<number> {
  const [control] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, "1200"))).limit(1);
  if (!control) return 0;
  const ids = (await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, tenantId), or(eq(accounts.id, control.id), eq(accounts.parentAccountId, control.id))))).map((a) => a.id);
  const rows = await db
    .select({ accountId: journalLines.accountId, d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(eq(journalEntries.tenantId, tenantId));
  const set = new Set(ids);
  return round2(rows.filter((r) => set.has(r.accountId)).reduce((s, r) => s + Number(r.d) - Number(r.c), 0));
}

/** Every item with what is on hand, its average cost and its value, and the total compared with the Inventory account. */
export async function getInventoryValuation(tenantId: string) {
  const rows = await db.select().from(items).where(eq(items.tenantId, tenantId));
  const list = rows
    .map((i) => {
      const quantity = Number(i.stockQuantity);
      const value = Number(i.stockValue);
      return { id: i.id, name: i.name, unitId: i.unitId, isActive: i.isActive, quantity, value, averageCost: quantity > 0 ? round2(value / quantity) : 0, purchasePrice: Number(i.purchasePrice) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const stockValue = round2(list.reduce((s, i) => s + i.value, 0));
  const ledger = await getInventoryLedgerBalance(tenantId);
  return { items: list, stockValue, ledger, difference: round2(ledger - stockValue) };
}
