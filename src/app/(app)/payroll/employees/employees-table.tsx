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

export function EmployeesTable({ employees, currentSalaries }: { employees: Employee[]; currentSalaries: Record<string, number> }) {
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
          className="rounded border border-gray-300 px-3 py-1.5 text-sm w-64"
        />
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Employee ID</th>
            <th className="px-4 py-2 font-medium">Full Name</th>
            <th className="px-4 py-2 font-medium">Department</th>
            <th className="px-4 py-2 font-medium">Designation</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Current Basic Salary</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((e) => (
            <tr key={e.id} className="border-t border-gray-100">
              <td className="px-4 py-2 font-mono">{e.employeeCode}</td>
              <td className="px-4 py-2">{e.fullName}</td>
              <td className="px-4 py-2">{e.department ?? "—"}</td>
              <td className="px-4 py-2">{e.designation ?? "—"}</td>
              <td className="px-4 py-2 capitalize">{e.employmentStatus.replace("_", " ")}</td>
              <td className="px-4 py-2">
                {(currentSalaries[e.id] ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
              <td className="px-4 py-2 text-right">
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
