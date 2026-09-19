"use client";

import { useState } from "react";
import { BillsTable } from "./bills-table";
import { PurchaseInvoiceForm } from "./purchase-invoice-form";
import { EditPurchaseInvoiceModal } from "./edit-purchase-invoice-modal";
import { ConfirmDialog } from "../sales/confirm-dialog";

type Vendor = { id: string; name: string };
type Item = { id: string; name: string; purchasePrice: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type Bill = {
  id: string;
  billNumber: string;
  vendorId: string | null;
  description: string | null;
  billDate: string;
  total: string;
  status: string;
};

const TABS = [
  { id: "invoices", label: "Invoices" },
  { id: "add", label: "Add Invoices" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function StockableTabs({
  vendors,
  bills,
  items,
  cashBankAccounts,
  vatRate,
}: {
  vendors: Vendor[];
  bills: Bill[];
  items: Item[];
  cashBankAccounts: CashBankGroup[];
  vatRate: number;
}) {
  const [tab, setTab] = useState<TabId>("invoices");
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
      <div className="inline-flex rounded-full bg-gray-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => handleTabClick(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              tab === t.id ? "bg-white text-gray-900 font-medium shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "invoices" && <BillsTable vendors={vendors} bills={bills} onEdit={setEditingBillId} />}
      {tab === "add" && (
        <PurchaseInvoiceForm
          vendors={vendors}
          items={items}
          cashBankAccounts={cashBankAccounts}
          vatRate={vatRate}
          onDirtyChange={setDirty}
        />
      )}

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
