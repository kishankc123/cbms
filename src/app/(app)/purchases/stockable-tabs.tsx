"use client";

import { useState } from "react";
import { BillsTable } from "./bills-table";
import { StatusPill } from "@/components/ui/status-pill";
import { PurchaseInvoiceForm } from "./purchase-invoice-form";
import { EditPurchaseInvoiceModal } from "./edit-purchase-invoice-modal";
import { ConfirmDialog } from "../sales/confirm-dialog";
import { AmountPurchaseGrid } from "./amount-purchase-grid";
import { ImportItems } from "./import/import-items";

type Vendor = { id: string; name: string };
type Item = { id: string; name: string; purchasePrice: string; purchaseVatTreatment?: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type Bill = {
  id: string;
  billNumber: string;
  vendorId: string | null;
  description: string | null;
  billDate: string;
  total: string;
  status: string;
  detailsPending?: boolean;
};

const TABS = [
  { id: "invoices", label: "Invoices" },
  { id: "single", label: "Single invoice" },
  { id: "multi", label: "Multi-invoice" },
  { id: "import", label: "Import purchases" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function StockableTabs({
  vendors,
  bills,
  paymentModes,
  items,
  cashBankAccounts,
  vendorBalances,
  vatRate,
}: {
  vendors: Vendor[];
  bills: Bill[];
  paymentModes: Record<string, string[]>;
  items: Item[];
  cashBankAccounts: CashBankGroup[];
  vendorBalances: Record<string, number>;
  vatRate: number;
}) {
  const [tab, setTab] = useState<TabId>("invoices");
  const waiting = bills.filter((b) => b.detailsPending && b.status !== "void").length;
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<TabId | null>(null);

  function handleTabClick(next: TabId) {
    if (next === tab) return;
    if (dirty) {
      setPendingTab(next);
      return;
    }
    setTab(next);
  }

  function confirmDiscardAndSwitch() {
    if (pendingTab) setTab(pendingTab);
    setPendingTab(null);
    setDirty(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => handleTabClick(t.id)}
            className={`relative inline-flex h-9 items-center whitespace-nowrap border-b-2 px-3 text-[13px] transition-colors ${tab === t.id ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {waiting > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px]">
          <StatusPill tone="pending">Details pending</StatusPill>
          <span className="text-ink">
            {waiting === 1 ? "1 purchase is" : `${waiting} purchases are`} waiting for item details. Stock and cost of goods sold do not change for them until the items are added.
          </span>
          {tab !== "invoices" && (
            <button type="button" onClick={() => handleTabClick("invoices")} className="ml-auto text-accent hover:underline">
              Show them
            </button>
          )}
        </div>
      )}

      {tab === "invoices" && <BillsTable vendors={vendors} bills={bills} paymentModes={paymentModes} onEdit={setEditingBillId} />}
      {tab === "single" && (
        <PurchaseInvoiceForm
          vendors={vendors}
          items={items}
          cashBankAccounts={cashBankAccounts}
          vatRate={vatRate}
          onDirtyChange={setDirty}
          onFinished={() => setTab("invoices")}
        />
      )}

      {tab === "multi" && <AmountPurchaseGrid vendors={vendors} categories={[]} cashBankAccounts={cashBankAccounts} vendorBalances={vendorBalances} vatRate={vatRate} pending onDirtyChange={setDirty} />}

      {tab === "import" && <ImportItems />}

      {pendingTab && (
        <ConfirmDialog
          message="You have unsaved changes on this tab. Switch tabs and discard them?"
          onYes={confirmDiscardAndSwitch}
          onNo={() => setPendingTab(null)}
        />
      )}

      {editingBillId && (
        <EditPurchaseInvoiceModal
          billId={editingBillId}
          vendors={vendors}
          items={items}
          cashBankAccounts={cashBankAccounts}
          vatRate={vatRate}
          onClose={() => setEditingBillId(null)}
        />
      )}
    </div>
  );
}
