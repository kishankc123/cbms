"use client";

import { useState } from "react";
import { EmployeesTable } from "./employees-table";
import { EmployeeAddForm } from "./employee-add-form";

type Employee = {
  id: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  designation: string | null;
  employmentStatus: string;
};

const TABS = [
  { id: "employees", label: "Employees" },
  { id: "add", label: "Add new" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function EmployeesTabs({ employees, currentSalaries }: { employees: Employee[]; currentSalaries: Record<string, number> | null }) {
  const [tab, setTab] = useState<TabId>("employees");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.filter((t) => t.id !== "add" || currentSalaries !== null).map((t) => (
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

      {tab === "employees" && <EmployeesTable employees={employees} currentSalaries={currentSalaries} />}
      {tab === "add" && <EmployeeAddForm onDone={() => setTab("employees")} />}
    </div>
  );
}
