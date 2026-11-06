"use client";

import { useState } from "react";
import { BillsTable } from "./bills-table";
import { AmountPurchaseGrid } from "./amount-purchase-grid";
import { EditCashBillModal } from "./edit-cash-bill-modal";
import { ConfirmDialog } from "../sales/confirm-dialog";

type Vendor = { id: string; name: string };
type Account = { id: string; code: string; name: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type Bill = { id: string; billNumber: string; vendorId: string | null; description: string | null; billDate: string; total: string; status: string };

const TABS = [
  { id: "bills", label: "Purchases" },
  { id: "add", label: "Add purchases" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// Purchases for an organization that does not track inventory: every bill is a bill amount, booked to Purchases. A bill is edited with the
// ordinary bill form (one line, the amount), which is why it offers the same categories.
export function AmountPurchaseTabs({ vendors, bills, paymentModes, categories, editCategories, cashBankAccounts, vendorBalances, vatRate }: { vendors: Vendor[]; bills: Bill[]; paymentModes: Record<string, string[]>; categories: Account[]; editCategories: Account[]; cashBankAccounts: CashBankGroup[]; vendorBalances: Record<string, number>; vatRate: number }) {
  const [tab, setTab] = useState<TabId>("bills");
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<TabId | null>(null);

  function choose(next: TabId) {
    if (next === tab) return;
    if (dirty) return setPendingTab(next);
    setTab(next);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => choose(t.id)} className={`relative inline-flex h-9 items-center whitespace-nowrap border-b-2 px-3 text-[13px] transition-colors ${tab === t.id ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "bills" && <BillsTable vendors={vendors} bills={bills} paymentModes={paymentModes} onEdit={setEditingBillId} />}
      {tab === "add" && <AmountPurchaseGrid vendors={vendors} categories={categories} cashBankAccounts={cashBankAccounts} vendorBalances={vendorBalances} vatRate={vatRate} onDirtyChange={setDirty} />}

      {pendingTab && (
        <ConfirmDialog
          message="You have unsaved purchases on this tab. Switch tabs and discard them?"
          onYes={() => {
            setTab(pendingTab);
            setPendingTab(null);
            setDirty(false);
          }}
          onNo={() => setPendingTab(null)}
        />
      )}

      {editingBillId && <EditCashBillModal billId={editingBillId} vendors={vendors} categoryAccounts={editCategories} cashBankAccounts={cashBankAccounts} vendorBalances={vendorBalances} vatRate={vatRate} onClose={() => setEditingBillId(null)} />}
    </div>
  );
}
