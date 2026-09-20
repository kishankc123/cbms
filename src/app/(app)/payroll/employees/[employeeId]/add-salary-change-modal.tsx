"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addSalaryChange } from "../actions";
import { computeNewSalary } from "@/lib/payroll/salary-change";

import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
const CHANGE_TYPES = [
  { value: "percentage_increase", label: "Percentage Increase" },
  { value: "percentage_decrease", label: "Percentage Decrease" },
  { value: "fixed_increase", label: "Fixed Amount Increase" },
  { value: "fixed_decrease", label: "Fixed Amount Decrease" },
  { value: "new_fixed", label: "New Fixed Salary" },
] as const;

type ChangeType = (typeof CHANGE_TYPES)[number]["value"];

const today = () => todayIso();

export function AddSalaryChangeModal({
  employeeId,
  currentSalary,
  onClose,
}: {
  employeeId: string;
  currentSalary: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [changeType, setChangeType] = useState<ChangeType>("percentage_increase");
  const [changeValue, setChangeValue] = useState("");
  const [newFixedSalary, setNewFixedSalary] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const newSalary = computeNewSalary(currentSalary, changeType, parseFloat(changeValue) || 0, parseFloat(newFixedSalary) || 0);

  async function handleSave() {
    setError(null);
    if (!reason.trim()) {
      setError("Reason is required.");
      return;
    }
    if (newSalary <= 0) {
      setError("The resulting salary must be greater than zero.");
      return;
    }
    setSaving(true);
    try {
      await addSalaryChange({
        employeeId,
        changeType,
        changeValue: parseFloat(changeValue) || 0,
        newFixedSalary: parseFloat(newFixedSalary) || 0,
        effectiveFrom,
        reason,
        notes,
      });
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative w-full max-w-md rounded-lg bg-white p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Add salary change</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <p className="text-sm text-gray-600">
          Current basic salary: <span className="font-medium text-gray-900">{currentSalary.toFixed(2)}</span>
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Change Type</label>
            <select value={changeType} onChange={(e) => setChangeType(e.target.value as ChangeType)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
              {CHANGE_TYPES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {changeType === "new_fixed" ? (
            <div>
              <label className="block text-xs text-gray-500 mb-1">New Fixed Salary</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={newFixedSalary}
                onChange={(e) => setNewFixedSalary(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                {changeType.startsWith("percentage") ? "Change Amount (%)" : "Change Amount (NPR)"}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={changeValue}
                onChange={(e) => setChangeValue(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          )}

          <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">New Basic Salary</span>
              <span className="font-medium text-gray-900">{newSalary.toFixed(2)}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Effective From Date</label>
            <DatePicker value={effectiveFrom} onChange={(v) => setEffectiveFrom(v)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Reason</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          {error && <span className="mr-auto self-center text-xs text-red-600">{error}</span>}
          <button type="button" onClick={onClose} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
