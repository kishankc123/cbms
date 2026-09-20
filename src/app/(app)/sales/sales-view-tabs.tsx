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
      <div className="inline-flex rounded-full bg-gray-100 p-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              view === v.id ? "bg-white text-gray-900 font-medium shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
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
