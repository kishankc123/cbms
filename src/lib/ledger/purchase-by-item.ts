import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { items, purchaseBills, purchaseReturns } from "@/db/schema";
import type { PurchaseLineItem } from "@/db/schema/purchases";
import { activePurchaseSourceIds } from "./purchase-summary";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type PurchaseByItemRow = {
  key: string;
  itemId: string | null;
  name: string;
  quantityPurchased: number;
  amount: number;
  quantityReturned: number;
  returnAmount: number;
  netAmount: number;
};

const lineNet = (l: PurchaseLineItem) => {
  const gross = round2(l.rate * l.quantity);
  const discount = round2(Math.min(Math.max(l.discount ?? 0, 0), gross));
  return round2(gross - discount);
};

/**
 * The purchase-side mirror of salesByItem() — the same active-bill set purchaseSummary() totals,
 * exploded to each bill's own line items and grouped by inventory item (or description text for a
 * free-typed line). A bill with no itemized lines (e.g. Consumable purchase entered without item detail)
 * rolls into its own "Not itemized" row using the bill's header subtotal, so nothing is dropped.
 */
export async function purchaseByItem(tenantId: string, periodStart: Date, periodEnd: Date): Promise<PurchaseByItemRow[]> {
  const { billIds, returnIds } = await activePurchaseSourceIds(tenantId, periodStart, periodEnd);

  const [bills, returns] = await Promise.all([
    billIds.length > 0 ? db.select({ lineItems: purchaseBills.lineItems, subtotal: purchaseBills.subtotal }).from(purchaseBills).where(inArray(purchaseBills.id, billIds)) : Promise.resolve([]),
    returnIds.length > 0 ? db.select({ lineItems: purchaseReturns.lineItems, subtotal: purchaseReturns.subtotal }).from(purchaseReturns).where(inArray(purchaseReturns.id, returnIds)) : Promise.resolve([]),
  ]);

  type Agg = { itemId: string | null; name: string; quantityPurchased: number; amount: number; quantityReturned: number; returnAmount: number };
  const byKey = new Map<string, Agg>();
  const keyOf = (l: PurchaseLineItem) => l.itemId ?? `desc:${l.description}`;
  const UNITEMIZED_KEY = "unitemized";
  const unitemized = (): Agg => byKey.get(UNITEMIZED_KEY) ?? { itemId: null, name: "Not itemized", quantityPurchased: 0, amount: 0, quantityReturned: 0, returnAmount: 0 };

  for (const b of bills) {
    if ((b.lineItems ?? []).length === 0) {
      const a = unitemized();
      a.amount = round2(a.amount + Number(b.subtotal));
      byKey.set(UNITEMIZED_KEY, a);
      continue;
    }
    for (const l of b.lineItems) {
      const key = keyOf(l);
      const a = byKey.get(key) ?? { itemId: l.itemId ?? null, name: l.description, quantityPurchased: 0, amount: 0, quantityReturned: 0, returnAmount: 0 };
      a.quantityPurchased = round2(a.quantityPurchased + l.quantity);
      a.amount = round2(a.amount + lineNet(l));
      byKey.set(key, a);
    }
  }
  for (const r of returns) {
    if ((r.lineItems ?? []).length === 0) {
      const a = unitemized();
      a.returnAmount = round2(a.returnAmount + Number(r.subtotal));
      byKey.set(UNITEMIZED_KEY, a);
      continue;
    }
    for (const l of r.lineItems) {
      const key = keyOf(l);
      const a = byKey.get(key) ?? { itemId: l.itemId ?? null, name: l.description, quantityPurchased: 0, amount: 0, quantityReturned: 0, returnAmount: 0 };
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
      quantityPurchased: a.quantityPurchased,
      amount: a.amount,
      quantityReturned: a.quantityReturned,
      returnAmount: a.returnAmount,
      netAmount: round2(a.amount - a.returnAmount),
    }))
    .sort((a, b) => b.netAmount - a.netAmount);
}
