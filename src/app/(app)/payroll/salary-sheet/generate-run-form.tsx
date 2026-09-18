"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { generatePayrollRun } from "./actions";

type Employee = { id: string; employeeCode: string; fullName: string; employmentStatus: string };

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function GenerateRunForm({ employees }: { employees: Employee[] }) {
  const router = useRouter();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleEmployee(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  }

  async function handleGenerate() {
    setError(null);
    setSaving(true);
    try {
      const runId = await generatePayrollRun({ month, year, employeeIds: selectedIds });
      router.push(`/payroll/salary-sheet/${runId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Payroll Month</label>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
            {MONTH_NAMES.map((name, i) => (
              <option key={i} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Payroll Year</label>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Employees (leave none checked to include all active employees)</label>
        <div className="max-h-56 overflow-y-auto rounded border border-gray-200 divide-y divide-gray-100">
          {employees.map((e) => (
            <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <input type="checkbox" checked={selectedIds.includes(e.id)} onChange={() => toggleEmployee(e.id)} />
              <span className="font-mono text-xs text-gray-500">{e.employeeCode}</span>
              <span>{e.fullName}</span>
            </label>
          ))}
          {employees.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">No employees yet</p>}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        {error && <span className="text-xs text-red-600">{error}</span>}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={saving}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
        >
          {saving ? "Generating..." : "Generate salary sheet"}
        </button>
      </div>
    </div>
  );
}
