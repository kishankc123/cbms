"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type Employee = {
  id: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  designation: string | null;
  employmentStatus: string;
};

export function EmployeesTable({ employees, currentSalaries }: { employees: Employee[]; currentSalaries: Record<string, number> | null }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.fullName.toLowerCase().includes(q) ||
        e.employeeCode.toLowerCase().includes(q) ||
        (e.department ?? "").toLowerCase().includes(q)
    );
  }, [employees, search]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employees..."
          className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-64"
        />
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-2.5 py-1.5 font-medium">Employee ID</th>
            <th className="px-2.5 py-1.5 font-medium">Full Name</th>
            <th className="px-2.5 py-1.5 font-medium">Department</th>
            <th className="px-2.5 py-1.5 font-medium">Designation</th>
            <th className="px-2.5 py-1.5 font-medium">Status</th>
            {currentSalaries && <th className="px-2.5 py-1.5 font-medium">Current Basic Salary</th>}
            <th className="px-2.5 py-1.5 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((e) => (
            <tr key={e.id} className="border-t border-gray-100">
              <td className="px-2.5 py-1.5 font-mono">{e.employeeCode}</td>
              <td className="px-2.5 py-1.5">{e.fullName}</td>
              <td className="px-2.5 py-1.5">{e.department ?? "—"}</td>
              <td className="px-2.5 py-1.5">{e.designation ?? "—"}</td>
              <td className="px-2.5 py-1.5 capitalize">{e.employmentStatus.replace("_", " ")}</td>
              {currentSalaries && <td className="px-2.5 py-1.5">{(currentSalaries[e.id] ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>}
              <td className="px-2.5 py-1.5 text-right">
                <Link href={`/payroll/employees/${e.id}`} className="text-xs text-gray-600 hover:underline">
                  View profile
                </Link>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                No employees yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
