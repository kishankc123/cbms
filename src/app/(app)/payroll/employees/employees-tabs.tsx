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

export function EmployeesTabs({ employees, currentSalaries }: { employees: Employee[]; currentSalaries: Record<string, number> }) {
  const [tab, setTab] = useState<TabId>("employees");

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

      {tab === "employees" && <EmployeesTable employees={employees} currentSalaries={currentSalaries} />}
      {tab === "add" && <EmployeeAddForm onDone={() => setTab("employees")} />}
    </div>
  );
}
