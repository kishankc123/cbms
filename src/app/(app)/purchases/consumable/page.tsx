import { and, eq, asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { vendors, purchaseBills, tenants } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { getCogsSubGroups } from "@/lib/ledger/control-accounts";
import { ConsumablePurchaseTabs } from "../consumable-purchase-tabs";

// "Consumable purchase" reuses the same immediate-settlement (no Accounts
// Payable) mechanics previously labeled "Cash purchase" — purchaseType
// stays "cash" internally; only the user-facing name changed.
export default async function ConsumablePurchasePage() {
  const session = await requireTenantSession();

  const [vendorList, billList, categoryAccounts, cashBankAccounts, [tenant]] = await Promise.all([
    db.select().from(vendors).where(eq(vendors.tenantId, session.tenantId)).orderBy(asc(vendors.name)),
    db
      .select()
      .from(purchaseBills)
      .where(and(eq(purchaseBills.tenantId, session.tenantId), eq(purchaseBills.purchaseType, "cash")))
      .orderBy(desc(purchaseBills.billDate)),
    getCogsSubGroups(session.tenantId),
    getCashBankAccounts(session.tenantId),
    db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1),
  ]);

  const vatRate = parseFloat(tenant?.vatRate ?? "0") || 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Consumable purchase</h1>

      <ConsumablePurchaseTabs
        vendors={vendorList}
        bills={billList}
        categoryAccounts={categoryAccounts}
        cashBankAccounts={cashBankAccounts}
        vatRate={vatRate}
      />
    </div>
  );
}
