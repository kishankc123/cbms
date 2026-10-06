"use client";

import { useState, type ReactNode } from "react";
import { ImportExpenses } from "./import/import-expenses";

// The Expenses list, with Import Expenses beside it (the import is only offered to people who can create expenses).
export function ExpensesTabs({ children, canImport }: { children: ReactNode; canImport: boolean }) {
  const [tab, setTab] = useState<"list" | "import">("list");
  if (!canImport) return <>{children}</>;
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-full bg-gray-100 p-1">
        {([["list", "Expenses"], ["import", "Import Expenses"]] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-full px-4 py-1.5 text-sm transition-colors ${tab === id ? "bg-white text-gray-900 font-medium shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "list" ? children : <ImportExpenses />}
    </div>
  );
}
