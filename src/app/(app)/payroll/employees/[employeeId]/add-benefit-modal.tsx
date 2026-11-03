"use client";

import { useEffect, useState } from "react";
import { useProblem } from "@/components/problem-dialog";
import { useRouter } from "next/navigation";
import { addBenefit } from "../actions";

import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
const FREQUENCIES = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "one_time", label: "One-time" },
] as const;

const today = () => todayIso();

export function AddBenefitModal({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const router = useRouter();
  const [benefitType, setBenefitType] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number]["value"]>("monthly");
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  // Problems are shown in a dialog that says why.
  const { report, dialog } = useProblem();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSave() {
    if (!benefitType.trim()) {
      report("Benefit type is required.", null);
      return;
    }
    setSaving(true);
    try {
      await addBenefit({ employeeId, benefitType, amount: parseFloat(amount) || 0, frequency, effectiveFrom, notes });
      router.refresh();
      onClose();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to save", null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={onClose} />

      <div className="relative w-full max-w-md rounded-[var(--radius-modal)] border border-line bg-surface p-5 shadow-[var(--shadow-modal)] space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Add benefit</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <p className="text-xs text-gray-500">
          Adding a benefit with the same type closes the previous open-ended record instead of overwriting it.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Benefit Type</label>
            <input
              value={benefitType}
              onChange={(e) => setBenefitType(e.target.value)}
              placeholder="e.g. Transport Allowance"
              className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Amount</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Frequency</label>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)} className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full">
              {FREQUENCIES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Effective From</label>
            <DatePicker value={effectiveFrom} onChange={(v) => setEffectiveFrom(v)} className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
      {dialog}
    </div>
  );
}
