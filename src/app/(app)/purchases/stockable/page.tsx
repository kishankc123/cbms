import { guardView } from "@/components/page-guard";
import { and, eq, asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentTaxRate } from "@/lib/compliance/tax-rates";
import { paymentModesByBill } from "@/lib/purchases/bill-payment-modes";
import { vendors, purchaseBills, items } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { StockableTabs } from "../stockable-tabs";
import { AmountPurchaseTabs } from "../amount-purchase-tabs";
import { getTrackInventory } from "@/lib/inventory/stock";
import { getOrCreatePurchasesAccount, getPurchaseCategories } from "@/lib/ledger/purchases-accounts";
import { getCogsSubGroups } from "@/lib/ledger/control-accounts";
import { getSupplierBalances } from "@/lib/ledger/supplier-balances";

// "Stockable purchase" reuses the same on-account (Accounts Payable) bill
// mechanics previously labeled "Credit purchase" — purchaseType stays
// "credit" internally; only the user-facing name changed. Items purchased
// this way post to Inventory (an asset) rather than straight to an expense
// account, since they're being stocked, not consumed.
export default async function StockablePurchasePage() {
  const denied = await guardView("purchases");
  if (denied) return denied;
  const session = await requireTenantSession();

  // An organization that does not track inventory records purchases by bill amount: no items, no stock, booked to Purchases.
  if (!(await getTrackInventory(session.tenantId))) {
    await getOrCreatePurchasesAccount(session.tenantId);
    const [vendorList, billList, categories, cogs, cashBankAccounts, vatRate, vendorBalances] = await Promise.all([
      db.select().from(vendors).where(eq(vendors.tenantId, session.tenantId)).orderBy(asc(vendors.name)),
      db.select().from(purchaseBills).where(and(eq(purchaseBills.tenantId, session.tenantId), eq(purchaseBills.purchaseType, "cash"))).orderBy(desc(purchaseBills.billDate)),
      getPurchaseCategories(session.tenantId),
      getCogsSubGroups(session.tenantId),
      getCashBankAccounts(session.tenantId),
      getCurrentTaxRate(session.tenantId, "vat"),
      getSupplierBalances(session.tenantId),
    ]);
    const paymentModes = await paymentModesByBill(session.tenantId, billList.map((b) => b.id));
    return (
      <div>
        <PageHeader title="Purchases" description="Record purchase bills by their amount." />
        <AmountPurchaseTabs vendors={vendorList} bills={billList} paymentModes={paymentModes} categories={categories} editCategories={[...categories, ...cogs]} cashBankAccounts={cashBankAccounts} vendorBalances={vendorBalances} vatRate={vatRate} />
      </div>
    );
  }

  const [vendorList, billList, itemList, cashBankAccounts, vatRate, vendorBalances] = await Promise.all([
    db.select().from(vendors).where(eq(vendors.tenantId, session.tenantId)).orderBy(asc(vendors.name)),
    db
      .select()
      .from(purchaseBills)
      .where(and(eq(purchaseBills.tenantId, session.tenantId), eq(purchaseBills.purchaseType, "credit")))
      .orderBy(desc(purchaseBills.billDate)),
    // Only inventory-tracked items are offered here — a Stockable purchase receives stock, so an untracked item
    // (whatever its type) has nothing here to receive.
    db.select().from(items).where(and(eq(items.tenantId, session.tenantId), eq(items.isActive, true), eq(items.inventoryTracking, true))).orderBy(asc(items.name)),
    getCashBankAccounts(session.tenantId),
    getCurrentTaxRate(session.tenantId, "vat"),
    getSupplierBalances(session.tenantId),
  ]);

  const paymentModes = await paymentModesByBill(session.tenantId, billList.map((b) => b.id));

  return (
    <div>
      <PageHeader title="Stockable purchase" description="Record inventory purchases and settlement details." />

      <StockableTabs
        vendors={vendorList}
        bills={billList}
        paymentModes={paymentModes}
        items={itemList}
        cashBankAccounts={cashBankAccounts}
        vendorBalances={vendorBalances}
        vatRate={vatRate}
      />
    </div>
  );
}
