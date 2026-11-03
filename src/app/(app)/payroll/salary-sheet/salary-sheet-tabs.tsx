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

      {tab === "runs" && <RunsTable runs={runs} />}
      {tab === "new" && <GenerateRunForm employees={employees} />}
    </div>
  );
}
