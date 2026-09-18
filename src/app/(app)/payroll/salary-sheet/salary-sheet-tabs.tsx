"use client";

import { useState } from "react";
import { RunsTable } from "./runs-table";
import { GenerateRunForm } from "./generate-run-form";

const TABS = [
  { id: "runs", label: "Payroll Runs" },
  { id: "new", label: "New run" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SalarySheetTabs({
  runs,
  employees,
}: {
  runs: Parameters<typeof RunsTable>[0]["runs"];
  employees: Parameters<typeof GenerateRunForm>[0]["employees"];
}) {
  const [tab, setTab] = useState<TabId>("runs");

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

      {tab === "runs" && <RunsTable runs={runs} />}
      {tab === "new" && <GenerateRunForm employees={employees} />}
    </div>
  );
}
