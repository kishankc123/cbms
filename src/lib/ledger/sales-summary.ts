import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries, salesInvoices, salesReturns } from "@/db/schema";

const round2 = (n: number) => Math.round(n * 100) / 100;
const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The period's sales, identified from currently-active (non-reversed) posted journal entries — the same
 * "sale"/"sales_return" sourceType/sourceId pair every other report drills through. A voided or
 * superseded (edited) invoice's old posting is reversed, so it drops out on its own; an edited invoice's
 * current total is what's counted, dated by its current entry. Shared by every Sales report that needs
 * "which invoices/returns actually count for this period," so each derives the same set the same way.
 */
export async function activeSalesSourceIds(tenantId: string, periodStart: Date, periodEnd: Date) {
  const startStr = toDateStr(periodStart);
  const endStr = toDateStr(periodEnd);

  const [saleEntries, returnEntries] = await Promise.all([
    db
      .select({ sourceId: journalEntries.sourceId })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.tenantId, tenantId),
          eq(journalEntries.sourceType, "sale"),
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
          eq(journalEntries.sourceType, "sales_return"),
          eq(journalEntries.isReversed, false),
          gte(journalEntries.entryDate, startStr),
          lte(journalEntries.entryDate, endStr)
        )
      ),
  ]);

  return {
    invoiceIds: [...new Set(saleEntries.map((r) => r.sourceId).filter((x): x is string => Boolean(x)))],
    returnIds: [...new Set(returnEntries.map((r) => r.sourceId).filter((x): x is string => Boolean(x)))],
  };
}

/**
 * Read back against the invoice/return's own current snapshot for the gross/discount/tax breakdown those
 * documents carry but a journal line doesn't.
 */
export async function salesSummary(tenantId: string, periodStart: Date, periodEnd: Date) {
  const startStr = toDateStr(periodStart);
  const endStr = toDateStr(periodEnd);
  const { invoiceIds, returnIds } = await activeSalesSourceIds(tenantId, periodStart, periodEnd);

  const [invoices, returns] = await Promise.all([
    invoiceIds.length > 0 ? db.select().from(salesInvoices).where(inArray(salesInvoices.id, invoiceIds)) : Promise.resolve([]),
    returnIds.length > 0 ? db.select().from(salesReturns).where(inArray(salesReturns.id, returnIds)) : Promise.resolve([]),
  ]);

  const grossAmount = round2(invoices.reduce((s, i) => s + Number(i.grossAmount), 0));
  const discountAmount = round2(invoices.reduce((s, i) => s + Number(i.discountAmount), 0));
  const subtotal = round2(invoices.reduce((s, i) => s + Number(i.subtotal), 0));
  const taxAmount = round2(invoices.reduce((s, i) => s + Number(i.taxAmount), 0));
  const totalInvoiced = round2(invoices.reduce((s, i) => s + Number(i.total), 0));
  const returnAmount = round2(returns.reduce((s, r) => s + Number(r.total), 0));

  return {
    periodStart: startStr,
    periodEnd: endStr,
    invoiceCount: invoices.length,
    grossAmount,
    discountAmount,
    subtotal,
    taxAmount,
    totalInvoiced,
    returnCount: returns.length,
    returnAmount,
    netSales: round2(totalInvoiced - returnAmount),
  };
}
