"use client";

import { useState } from "react";
import { DetailsPanel } from "./details-panel";
import { HistoryPanel } from "./history-panel";

const TABS = [
  { id: "details", label: "Details" },
  { id: "history", label: "Transaction History" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ProfileTabs({
  supplier,
  purchases,
  paid,
  other,
  outstanding,
  fiscalYearStartDate,
}: {
  supplier: { id: string; name: string; panNumber: string; businessType: string; phone: string; details: string; openingBalance: number };
  purchases: number;
  paid: number;
  /** Net of other entries posted to the supplier's account (e.g. journal vouchers). */
  other: number;
  outstanding: number;
  fiscalYearStartDate: string | null;
}) {
  const [tab, setTab] = useState<TabId>("details");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative inline-flex h-9 items-center whitespace-nowrap border-b-2 px-3 text-[13px] transition-colors ${tab === t.id ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "details" && (
        <DetailsPanel supplier={supplier} purchases={purchases} paid={paid} other={other} outstanding={outstanding} />
      )}
      {tab === "history" && <HistoryPanel supplierId={supplier.id} fiscalYearStartDate={fiscalYearStartDate} />}
    </div>
  );
}
