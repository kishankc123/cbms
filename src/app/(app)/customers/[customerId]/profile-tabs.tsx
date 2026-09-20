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
  customer,
  sales,
  paid,
  other,
  outstanding,
  fiscalYearStartDate,
}: {
  customer: { id: string; name: string; panNumber: string; phone: string; details: string; openingBalance: number };
  sales: number;
  paid: number;
  /** Net of other entries posted to the customer's account (e.g. journal vouchers). */
  other: number;
  outstanding: number;
  fiscalYearStartDate: string | null;
}) {
  const [tab, setTab] = useState<TabId>("details");

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

      {tab === "details" && <DetailsPanel customer={customer} sales={sales} paid={paid} other={other} outstanding={outstanding} />}
      {tab === "history" && <HistoryPanel customerId={customer.id} fiscalYearStartDate={fiscalYearStartDate} />}
    </div>
  );
}
