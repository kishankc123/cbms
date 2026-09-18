"use client";

import { useState } from "react";
import { BillsTable } from "./bills-table";
import { ConsumablePurchaseForm } from "./consumable-purchase-form";
import { EditCashBillModal } from "./edit-cash-bill-modal";

type Vendor = { id: string; name: string };
type Account = { id: string; code: string; name: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type Bill = { id: string; billNumber: string; vendorId: string; billDate: string; total: string; status: string };

const TABS = [
  { id: "invoices", label: "Invoices" },
  { id: "add", label: "Add new" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ConsumablePurchaseTabs({
  vendors,
  bills,
  categoryAccounts,
  cashBankAccounts,
  vatRate,
}: {
  vendors: Vendor[];
  bills: Bill[];
  categoryAccounts: Account[];
  cashBankAccounts: CashBankGroup[];
  vatRate: number;
}) {
  const [tab, setTab] = useState<TabId>("invoices");
  const [editingBillId, setEditingBillId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-full bg-gray-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
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
        <ConsumablePurchaseForm
          vendors={vendors}
          categoryAccounts={categoryAccounts}
          cashBankAccounts={cashBankAccounts}
          vatRate={vatRate}
        />
      )}

      {editingBillId && (
        <EditCashBillModal
          billId={editingBillId}
          vendors={vendors}
          categoryAccounts={categoryAccounts}
          cashBankAccounts={cashBankAccounts}
          vatRate={vatRate}
          onClose={() => setEditingBillId(null)}
        />
      )}
    </div>
  );
}
