"use client";

import { useState, type ReactNode } from "react";

const VIEWS = [
  { id: "invoices", label: "Invoices" },
  { id: "new", label: "Add new" },
] as const;
export type SalesView = (typeof VIEWS)[number]["id"];

/** The Sales page's two views — Add new and Invoices — as a switcher, so Sales is a single nav entry. */
export function SalesViewTabs({ initialView, addNew, invoices }: { initialView: SalesView; addNew: ReactNode; invoices: ReactNode }) {
  const [view, setView] = useState<SalesView>(initialView);
  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto border-b border-line">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            className={`relative inline-flex h-9 items-center whitespace-nowrap border-b-2 px-3 text-[13px] transition-colors ${view === v.id ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {/* Both stay mounted so a half-filled invoice survives a peek at the invoice list. */}
      <div hidden={view !== "new"}>{addNew}</div>
      <div hidden={view !== "invoices"}>{invoices}</div>
    </div>
  );
}
