import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { expenses, purchaseBills, salesInvoices } from "@/db/schema";

type Source = { sourceType: string | null; sourceId: string | null };

function joinLines(items: { description?: string | null }[] | null | undefined): string | null {
  const parts = (items ?? []).map((i) => (i.description ?? "").trim()).filter(Boolean);
  return parts.length ? Array.from(new Set(parts)).join(", ") : null;
}

/**
 * The description the person typed on the source document: an expense's description, a bill's description (or its item
 * descriptions), an invoice's item descriptions. Keyed "sourceType:sourceId"; documents with nothing typed are absent, and the
 * caller falls back to the text written at posting time.
 */
export async function recordedDescriptions(tenantId: string, sources: Source[]): Promise<Map<string, string>> {
  const idsOf = (type: string) => Array.from(new Set(sources.filter((s) => s.sourceType === type && s.sourceId).map((s) => s.sourceId as string)));
  const out = new Map<string, string>();

  const expenseIds = idsOf("expense");
  if (expenseIds.length) {
    const rows = await db.select({ id: expenses.id, description: expenses.description }).from(expenses).where(and(eq(expenses.tenantId, tenantId), inArray(expenses.id, expenseIds)));
    for (const r of rows) if (r.description?.trim()) out.set("expense:" + r.id, r.description.trim());
  }
  const billIds = idsOf("purchase");
  if (billIds.length) {
    const rows = await db
      .select({ id: purchaseBills.id, description: purchaseBills.description, lineItems: purchaseBills.lineItems })
      .from(purchaseBills)
      .where(and(eq(purchaseBills.tenantId, tenantId), inArray(purchaseBills.id, billIds)));
    for (const r of rows) {
      const d = r.description?.trim() || joinLines(r.lineItems);
      if (d) out.set("purchase:" + r.id, d);
    }
  }
  const invoiceIds = idsOf("sale");
  if (invoiceIds.length) {
    const rows = await db
      .select({ id: salesInvoices.id, lineItems: salesInvoices.lineItems })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.tenantId, tenantId), inArray(salesInvoices.id, invoiceIds)));
    for (const r of rows) {
      const d = joinLines(r.lineItems);
      if (d) out.set("sale:" + r.id, d);
    }
  }
  return out;
}
