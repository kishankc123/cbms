import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries, purchaseBills, purchaseReturns } from "@/db/schema";

const round2 = (n: number) => Math.round(n * 100) / 100;
const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The purchase-side mirror of activeSalesSourceIds() (sales-summary.ts) — the period's purchases,
 * identified from currently-active (non-reversed) posted journal entries for "purchase"/"purchase_return".
 * Shared by every Purchase report that needs "which bills/returns actually count for this period."
 */
export async function activePurchaseSourceIds(tenantId: string, periodStart: Date, periodEnd: Date) {
  const startStr = toDateStr(periodStart);
  const endStr = toDateStr(periodEnd);

  const [billEntries, returnEntries] = await Promise.all([
    db
      .select({ sourceId: journalEntries.sourceId })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.tenantId, tenantId),
          eq(journalEntries.sourceType, "purchase"),
          eq(journalEntries.isReversed, false),
          gte(journalEntries.entryDate, startStr),
          lte(journalEntries.entryDate, endStr)
        )
      ),
    db
      .select({ sourceId: journalEntries.sourceId })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.tenantId, tenantId),
          eq(journalEntries.sourceType, "purchase_return"),
          eq(journalEntries.isReversed, false),
          gte(journalEntries.entryDate, startStr),
          lte(journalEntries.entryDate, endStr)
        )
      ),
  ]);

  return {
    billIds: [...new Set(billEntries.map((r) => r.sourceId).filter((x): x is string => Boolean(x)))],
    returnIds: [...new Set(returnEntries.map((r) => r.sourceId).filter((x): x is string => Boolean(x)))],
  };
}

/** Read back against the bill/return's own current snapshot for the gross/discount... breakdown a journal line doesn't carry. */
export async function purchaseSummary(tenantId: string, periodStart: Date, periodEnd: Date) {
  const startStr = toDateStr(periodStart);
  const endStr = toDateStr(periodEnd);
  const { billIds, returnIds } = await activePurchaseSourceIds(tenantId, periodStart, periodEnd);

  const [bills, returns] = await Promise.all([
    billIds.length > 0 ? db.select().from(purchaseBills).where(inArray(purchaseBills.id, billIds)) : Promise.resolve([]),
    returnIds.length > 0 ? db.select().from(purchaseReturns).where(inArray(purchaseReturns.id, returnIds)) : Promise.resolve([]),
  ]);

  const subtotal = round2(bills.reduce((s, b) => s + Number(b.subtotal), 0));
  const taxAmount = round2(bills.reduce((s, b) => s + Number(b.taxAmount), 0));
  const totalBilled = round2(bills.reduce((s, b) => s + Number(b.total), 0));
  const returnAmount = round2(returns.reduce((s, r) => s + Number(r.total), 0));

  return {
    periodStart: startStr,
    periodEnd: endStr,
    billCount: bills.length,
    subtotal,
    taxAmount,
    totalBilled,
    returnCount: returns.length,
    returnAmount,
    netPurchases: round2(totalBilled - returnAmount),
  };
}
