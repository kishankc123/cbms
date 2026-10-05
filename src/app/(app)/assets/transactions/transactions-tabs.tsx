"use client";

import { useState } from "react";
import type { AssetPurchaseFormData, DisposalFormData, OpeningAssetsData } from "../actions";
import { DisposalPanel } from "./disposal-panel";
import { OpeningAssetsPanel } from "./opening-assets-panel";
import { AssetPurchaseForm } from "./asset-purchase-form";

const TABS = [
  { id: "purchase", label: "Purchase asset" },
  { id: "opening", label: "Opening assets" },
  { id: "sell", label: "Sell / dispose / write off" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function TransactionsTabs({ data, opening, disposal }: { data: AssetPurchaseFormData; opening: OpeningAssetsData; disposal: DisposalFormData }) {
  const [tab, setTab] = useState<TabId>("purchase");
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-full bg-[var(--surface-muted-bg)] p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${tab === t.id ? "bg-[var(--card-bg)] text-[var(--text-primary)] font-medium shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "purchase" &&
        (data.canCreate ? <AssetPurchaseForm data={data} /> : <p className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-6 text-sm text-[var(--text-secondary)]">You don&apos;t have permission to purchase assets.</p>)}
      {tab === "opening" && <OpeningAssetsPanel data={opening} />}
      {tab === "sell" && <DisposalPanel data={disposal} />}
    </div>
  );
}
