import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { vendors, purchaseBills, purchaseReturns } from "@/db/schema";
import { activePurchaseSourceIds } from "./purchase-summary";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type PurchaseBySupplierRow = {
  vendorId: string;
  accountId: string | null;
  vendorName: string;
  billCount: number;
  totalBilled: number;
  returnCount: number;
  returnAmount: number;
  netPurchases: number;
};

const NO_SUPPLIER_KEY = "no-supplier";

/**
 * The same active-bill set purchaseSummary() totals, grouped by supplier instead of summed across all.
 * A Consumable purchase can be entered with no supplier chosen — that spend is still real, so it rolls
 * into its own "No Supplier" row instead of being dropped, and the report's total still ties to
 * purchaseSummary()'s Total Billed.
 */
export async function purchaseBySupplier(tenantId: string, periodStart: Date, periodEnd: Date): Promise<PurchaseBySupplierRow[]> {
  const { billIds, returnIds } = await activePurchaseSourceIds(tenantId, periodStart, periodEnd);

  const [bills, returns] = await Promise.all([
    billIds.length > 0 ? db.select({ vendorId: purchaseBills.vendorId, total: purchaseBills.total }).from(purchaseBills).where(inArray(purchaseBills.id, billIds)) : Promise.resolve([]),
    returnIds.length > 0 ? db.select({ vendorId: purchaseReturns.vendorId, total: purchaseReturns.total }).from(purchaseReturns).where(inArray(purchaseReturns.id, returnIds)) : Promise.resolve([]),
  ]);

  type Agg = { billCount: number; totalBilled: number; returnCount: number; returnAmount: number };
  const byVendor = new Map<string, Agg>();
  const empty = (): Agg => ({ billCount: 0, totalBilled: 0, returnCount: 0, returnAmount: 0 });

  for (const b of bills) {
    const key = b.vendorId ?? NO_SUPPLIER_KEY;
    const a = byVendor.get(key) ?? empty();
    a.billCount += 1;
    a.totalBilled = round2(a.totalBilled + Number(b.total));
    byVendor.set(key, a);
  }
  for (const r of returns) {
    const key = r.vendorId ?? NO_SUPPLIER_KEY;
    const a = byVendor.get(key) ?? empty();
    a.returnCount += 1;
    a.returnAmount = round2(a.returnAmount + Number(r.total));
    byVendor.set(key, a);
  }

  const vendorIds = [...byVendor.keys()].filter((k) => k !== NO_SUPPLIER_KEY);
  const vendorRows = vendorIds.length > 0 ? await db.select({ id: vendors.id, name: vendors.name, accountId: vendors.payableAccountId }).from(vendors).where(inArray(vendors.id, vendorIds)) : [];
  const vendorById = new Map(vendorRows.map((v) => [v.id, v]));

  return [...byVendor.entries()]
    .map(([vendorId, a]) => ({
      vendorId,
      accountId: vendorId === NO_SUPPLIER_KEY ? null : (vendorById.get(vendorId)?.accountId ?? null),
      vendorName: vendorId === NO_SUPPLIER_KEY ? "No Supplier" : (vendorById.get(vendorId)?.name ?? "—"),
      billCount: a.billCount,
      totalBilled: a.totalBilled,
      returnCount: a.returnCount,
      returnAmount: a.returnAmount,
      netPurchases: round2(a.totalBilled - a.returnAmount),
    }))
    .sort((a, b) => b.netPurchases - a.netPurchases);
}
