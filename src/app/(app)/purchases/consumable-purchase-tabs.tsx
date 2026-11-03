"use client";

import { useState } from "react";
import { BillsTable } from "./bills-table";
import { ConsumablePurchaseForm } from "./consumable-purchase-form";
import { EditCashBillModal } from "./edit-cash-bill-modal";
import { ConfirmDialog } from "../sales/confirm-dialog";
import { ImportPurchases } from "./import/import-purchases";

type Vendor = { id: string; name: string };
type Account = { id: string; code: string; name: string };
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
  { id: "add", label: "Add New" },
  { id: "import", label: "Import Purchases" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ConsumablePurchaseTabs({
  vendors,
  bills,
  paymentModes,
  categoryAccounts,
  cashBankAccounts,
  vendorBalances,
  vatRate,
}: {
  vendors: Vendor[];
  bills: Bill[];
  paymentModes: Record<string, string[]>;
  categoryAccounts: Account[];
  cashBankAccounts: CashBankGroup[];
  vendorBalances: Record<string, number>;
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

      {tab === "invoices" && <BillsTable vendors={vendors} bills={bills} paymentModes={paymentModes} onEdit={setEditingBillId} />}
      {tab === "import" && <ImportPurchases />}
      {tab === "add" && (
        <ConsumablePurchaseForm
          vendors={vendors}
          categoryAccounts={categoryAccounts}
          cashBankAccounts={cashBankAccounts}
          vendorBalances={vendorBalances}
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
        <EditCashBillModal
          billId={editingBillId}
          vendors={vendors}
          categoryAccounts={categoryAccounts}
          cashBankAccounts={cashBankAccounts}
          vendorBalances={vendorBalances}
          vatRate={vatRate}
          onClose={() => setEditingBillId(null)}
        />
      )}
    </div>
  );
}
