import { and, eq, asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { vendors, purchaseBills, items, tenants } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { StockableTabs } from "../stockable-tabs";

// "Stockable purchase" reuses the same on-account (Accounts Payable) bill
// mechanics previously labeled "Credit purchase" — purchaseType stays
// "credit" internally; only the user-facing name changed. Items purchased
// this way post to Inventory (an asset) rather than straight to an expense
// account, since they're being stocked, not consumed.
export default async function StockablePurchasePage() {
  const session = await requireTenantSession();

  const [vendorList, billList, itemList, cashBankAccounts, [tenant]] = await Promise.all([
    db.select().from(vendors).where(eq(vendors.tenantId, session.tenantId)).orderBy(asc(vendors.name)),
    db
      .select()
      .from(purchaseBills)
      .where(and(eq(purchaseBills.tenantId, session.tenantId), eq(purchaseBills.purchaseType, "credit")))
      .orderBy(desc(purchaseBills.billDate)),
    db.select().from(items).where(eq(items.tenantId, session.tenantId)).orderBy(asc(items.name)),
    getCashBankAccounts(session.tenantId),
    db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1),
  ]);

  const vatRate = parseFloat(tenant?.vatRate ?? "0") || 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Stockable purchase</h1>

      <StockableTabs
        vendors={vendorList}
        bills={billList}
        items={itemList}
        cashBankAccounts={cashBankAccounts}
        vatRate={vatRate}
      />
    </div>
  );
}
