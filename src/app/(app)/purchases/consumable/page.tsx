import { guardView } from "@/components/page-guard";
import { and, eq, asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentTaxRate } from "@/lib/compliance/tax-rates";
import { paymentModesByBill } from "@/lib/purchases/bill-payment-modes";
import { vendors, purchaseBills } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { getCogsSubGroups } from "@/lib/ledger/control-accounts";
import { getSupplierBalances } from "@/lib/ledger/supplier-balances";
import { ConsumablePurchaseTabs } from "../consumable-purchase-tabs";

// "Consumable purchase" was previously labeled "Cash purchase" — purchaseType stays "cash" internally; only the
// user-facing name changed. A bill can be paid in full, in part or not at all; any balance is owed to the supplier.
export default async function ConsumablePurchasePage() {
  const denied = await guardView("purchases");
  if (denied) return denied;
  const session = await requireTenantSession();

  const [vendorList, billList, categoryAccounts, cashBankAccounts, vatRate, vendorBalances] = await Promise.all([
    db.select().from(vendors).where(eq(vendors.tenantId, session.tenantId)).orderBy(asc(vendors.name)),
    db
      .select()
      .from(purchaseBills)
      .where(and(eq(purchaseBills.tenantId, session.tenantId), eq(purchaseBills.purchaseType, "cash")))
      .orderBy(desc(purchaseBills.billDate)),
    getCogsSubGroups(session.tenantId),
    getCashBankAccounts(session.tenantId),
    getCurrentTaxRate(session.tenantId, "vat"),
    getSupplierBalances(session.tenantId),
  ]);

  const paymentModes = await paymentModesByBill(session.tenantId, billList.map((b) => b.id));

  return (
    <div>
      <PageHeader title="Consumable purchase" description="Record operating purchases and settlement details." />

      <ConsumablePurchaseTabs
        vendors={vendorList}
        bills={billList}
        paymentModes={paymentModes}
        categoryAccounts={categoryAccounts}
        cashBankAccounts={cashBankAccounts}
        vendorBalances={vendorBalances}
        vatRate={vatRate}
      />
    </div>
  );
}
