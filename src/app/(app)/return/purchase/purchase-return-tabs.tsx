"use client";

import { useState } from "react";
import { PurchaseReturnForm } from "./return-form";
import { PurchaseReturnsTable } from "./returns-table";
import { ConfirmDialog } from "../../sales/confirm-dialog";

type Vendor = { id: string; name: string };
type Item = { id: string; name: string; purchasePrice: string };
type Note = { id: string; noteNumber: string; vendorId: string; noteDate: string; total: string; status: string };

const TABS = [
  { id: "notes", label: "Credit notes" },
  { id: "new", label: "Add new" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function PurchaseReturnTabs({
  vendors,
  items,
  vatRate,
  noteList,
  initialTab,
}: {
  vendors: Vendor[];
  items: Item[];
  vatRate: number;
  noteList: Note[];
  initialTab: TabId;
}) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [dirty, setDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<TabId | null>(null);
  const vendorById = Object.fromEntries(vendors.map((c) => [c.id, c]));

  function handleTabClick(next: TabId) {
    if (next === tab) return;
    if (dirty) return setPendingTab(next);
    setTab(next);
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

      {tab === "notes" && <PurchaseReturnsTable noteList={noteList} vendorById={vendorById} />}
      {tab === "new" && <PurchaseReturnForm vendors={vendors} items={items} vatRate={vatRate} onDirtyChange={setDirty} />}

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
