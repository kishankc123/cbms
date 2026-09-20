"use client";

import { useState } from "react";
import { SalesReturnForm } from "./return-form";
import { SalesReturnsTable } from "./returns-table";
import { ConfirmDialog } from "../../sales/confirm-dialog";

type Customer = { id: string; name: string };
type Item = { id: string; name: string; sellingPrice: string };
type Note = { id: string; noteNumber: string; customerId: string; noteDate: string; total: string; status: string };

const TABS = [
  { id: "notes", label: "Debit notes" },
  { id: "new", label: "Add new" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function SalesReturnTabs({
  customers,
  items,
  vatRate,
  noteList,
  initialTab,
}: {
  customers: Customer[];
  items: Item[];
  vatRate: number;
  noteList: Note[];
  initialTab: TabId;
}) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [dirty, setDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<TabId | null>(null);
  const customerById = Object.fromEntries(customers.map((c) => [c.id, c]));

  function handleTabClick(next: TabId) {
    if (next === tab) return;
    if (dirty) return setPendingTab(next);
    setTab(next);
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

      {tab === "notes" && <SalesReturnsTable noteList={noteList} customerById={customerById} />}
      {tab === "new" && <SalesReturnForm customers={customers} items={items} vatRate={vatRate} onDirtyChange={setDirty} />}

      {pendingTab && (
        <ConfirmDialog
          message="You have unsaved changes on this tab. Switch tabs and discard them?"
          onYes={() => {
            setTab(pendingTab);
            setPendingTab(null);
            setDirty(false);
          }}
          onNo={() => setPendingTab(null)}
        />
      )}
    </div>
  );
}
