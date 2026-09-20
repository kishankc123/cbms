"use client";

import { useState } from "react";
import { AddSalaryChangeModal } from "./add-salary-change-modal";

import { D, DT } from "@/components/calendar/date-text";
type SalaryRecord = {
  id: string;
  effectiveFrom: string;
  basicSalary: string;
  changeType: string;
  previousSalary: string | null;
  changeAmount: string | null;
  changePercentage: string | null;
  reason: string | null;
  notes: string | null;
  createdAt: string;
  createdByName: string;
};

const CHANGE_TYPE_LABELS: Record<string, string> = {
  initial: "Initial",
  percentage_increase: "Percentage Increase",
  percentage_decrease: "Percentage Decrease",
  fixed_increase: "Fixed Increase",
  fixed_decrease: "Fixed Decrease",
  new_fixed: "New Fixed Salary",
};

export function SalaryHistoryPanel({
  employeeId,
  currentSalary,
  records,
}: {
  employeeId: string;
  currentSalary: number;
  records: SalaryRecord[];
}) {
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Current basic salary: <span className="font-medium text-gray-900">{currentSalary.toFixed(2)}</span>
        </p>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
        >
          + Add Salary Change
        </button>
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Effective From</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Basic Salary</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Change Type</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Previous Salary</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Change Amount</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Change %</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Reason</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Notes</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Created</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Created By</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <td className="px-3 py-2 whitespace-nowrap"><D value={r.effectiveFrom} /></td>
              <td className="px-3 py-2 whitespace-nowrap">{Number(r.basicSalary).toFixed(2)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{CHANGE_TYPE_LABELS[r.changeType] ?? r.changeType}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r.previousSalary ? Number(r.previousSalary).toFixed(2) : "—"}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r.changeAmount ? Number(r.changeAmount).toFixed(2) : "—"}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r.changePercentage ? `${Number(r.changePercentage).toFixed(2)}%` : "—"}</td>
              <td className="px-3 py-2">{r.reason ?? "—"}</td>
              <td className="px-3 py-2">{r.notes ?? "—"}</td>
              <td className="px-3 py-2 whitespace-nowrap"><DT value={r.createdAt} dateOnly /></td>
              <td className="px-3 py-2 whitespace-nowrap">{r.createdByName}</td>
            </tr>
          ))}
          {records.length === 0 && (
            <tr>
              <td colSpan={10} className="px-4 py-6 text-center text-gray-400">
                No salary history yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {showAdd && (
        <AddSalaryChangeModal employeeId={employeeId} currentSalary={currentSalary} onClose={() => setShowAdd(false)} />
      )}
    </div>
  );
}
