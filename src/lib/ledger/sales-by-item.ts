import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { items, salesInvoices, salesReturns } from "@/db/schema";
import type { LineItem } from "@/db/schema/sales";
import { activeSalesSourceIds } from "./sales-summary";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type SalesByItemRow = {
  key: string;
  itemId: string | null;
  name: string;
  quantitySold: number;
  revenue: number;
  quantityReturned: number;
  returnAmount: number;
  netRevenue: number;
};

// Same per-line arithmetic computeSingleLine() uses when an invoice is created (gross = rate * qty,
// discount clipped to the line, taxable = gross - discount) — the pre-tax, net-of-discount amount that
// actually posts to Sales Revenue, so this report's totals are the revenue an item actually earned.
const lineNet = (l: LineItem) => {
  const gross = round2(l.unitPrice * l.quantity);
  const discount = round2(Math.min(Math.max(l.discount ?? 0, 0), gross));
  return round2(gross - discount);
};

/**
 * The same active-invoice set salesSummary() totals, exploded to each invoice's own line items (stored
 * as JSON on the invoice, not a normalized table) and grouped by the inventory item they were billed
 * against — or by description text for a free-typed line with no item selected.
 */
export async function salesByItem(tenantId: string, periodStart: Date, periodEnd: Date): Promise<SalesByItemRow[]> {
  const { invoiceIds, returnIds } = await activeSalesSourceIds(tenantId, periodStart, periodEnd);

  const [invoices, returns] = await Promise.all([
    invoiceIds.length > 0 ? db.select({ lineItems: salesInvoices.lineItems, subtotal: salesInvoices.subtotal }).from(salesInvoices).where(inArray(salesInvoices.id, invoiceIds)) : Promise.resolve([]),
    returnIds.length > 0 ? db.select({ lineItems: salesReturns.lineItems, subtotal: salesReturns.subtotal }).from(salesReturns).where(inArray(salesReturns.id, returnIds)) : Promise.resolve([]),
  ]);

  type Agg = { itemId: string | null; name: string; quantitySold: number; revenue: number; quantityReturned: number; returnAmount: number };
  const byKey = new Map<string, Agg>();
  const keyOf = (l: LineItem) => l.itemId ?? `desc:${l.description}`;
  const UNITEMIZED_KEY = "unitemized";
  // Not every invoice went through the itemized flow (e.g. a Multi-invoice/batch invoice stores no
  // per-line detail) — its revenue is still real and must still count, so it lands in its own row
  // rather than silently vanishing from the report's total.
  const unitemized = (): Agg => byKey.get(UNITEMIZED_KEY) ?? { itemId: null, name: "Not itemized", quantitySold: 0, revenue: 0, quantityReturned: 0, returnAmount: 0 };

  for (const inv of invoices) {
    if ((inv.lineItems ?? []).length === 0) {
      const a = unitemized();
      a.revenue = round2(a.revenue + Number(inv.subtotal));
      byKey.set(UNITEMIZED_KEY, a);
      continue;
    }
    for (const l of inv.lineItems) {
      const key = keyOf(l);
      const a = byKey.get(key) ?? { itemId: l.itemId ?? null, name: l.description, quantitySold: 0, revenue: 0, quantityReturned: 0, returnAmount: 0 };
      a.quantitySold = round2(a.quantitySold + l.quantity);
      a.revenue = round2(a.revenue + lineNet(l));
      byKey.set(key, a);
    }
  }
  for (const ret of returns) {
    if ((ret.lineItems ?? []).length === 0) {
      const a = unitemized();
      a.returnAmount = round2(a.returnAmount + Number(ret.subtotal));
      byKey.set(UNITEMIZED_KEY, a);
      continue;
    }
    for (const l of ret.lineItems) {
      const key = keyOf(l);
      const a = byKey.get(key) ?? { itemId: l.itemId ?? null, name: l.description, quantitySold: 0, revenue: 0, quantityReturned: 0, returnAmount: 0 };
      a.quantityReturned = round2(a.quantityReturned + l.quantity);
      a.returnAmount = round2(a.returnAmount + lineNet(l));
      byKey.set(key, a);
    }
  }

  const itemIds = [...byKey.values()].map((a) => a.itemId).filter((x): x is string => Boolean(x));
  const itemRows = itemIds.length > 0 ? await db.select({ id: items.id, name: items.name }).from(items).where(inArray(items.id, itemIds)) : [];
  const nameById = new Map(itemRows.map((i) => [i.id, i.name]));

  return [...byKey.entries()]
    .map(([key, a]) => ({
      key,
      itemId: a.itemId,
      name: a.itemId ? (nameById.get(a.itemId) ?? a.name) : a.name,
      quantitySold: a.quantitySold,
      revenue: a.revenue,
      quantityReturned: a.quantityReturned,
      returnAmount: a.returnAmount,
      netRevenue: round2(a.revenue - a.returnAmount),
    }))
    .sort((a, b) => b.netRevenue - a.netRevenue);
}
