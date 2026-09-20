"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createPeriod, closePeriod, reopenPeriod, type listPeriods } from "../actions";

import { DatePicker } from "@/components/calendar/date-picker";
import { D } from "@/components/calendar/date-text";
import { useCalendar } from "@/components/calendar/calendar-provider";
import { monthChoices, todayIso } from "@/lib/calendar";
type Period = Awaited<ReturnType<typeof listPeriods>>[number];

export function PeriodsTable({ periods }: { periods: Period[] }) {
  const router = useRouter();
  const calendar = useCalendar();
  // Real month boundaries in the organization's calendar (BS months are 29–32 days).
  const months = useMemo(() => monthChoices(calendar, todayIso(), 14, 2), [calendar]);
  const [showNew, setShowNew] = useState(false);
  const [label, setLabel] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    setBusy(true);
    try {
      await createPeriod({ label, periodStart, periodEnd });
      setShowNew(false);
      setLabel("");
      setPeriodStart("");
      setPeriodEnd("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create period");
    } finally {
      setBusy(false);
    }
  }

  async function handleClose(id: string) {
    if (!confirm("Close this period? Postings dated inside it will be blocked until reopened.")) return;
    setBusy(true);
    setError(null);
    try {
      await closePeriod(id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to close period");
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    if (!reopeningId) return;
    setBusy(true);
    setError(null);
    try {
      await reopenPeriod({ periodId: reopeningId, reason: reopenReason });
      setReopeningId(null);
      setReopenReason("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reopen period");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
        >
          + New Period
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Label</th>
            <th className="px-4 py-2 font-medium">Start</th>
            <th className="px-4 py-2 font-medium">End</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id} className="border-t border-gray-100">
              <td className="px-4 py-2">{p.label}</td>
              <td className="px-4 py-2"><D value={p.periodStart} /></td>
              <td className="px-4 py-2"><D value={p.periodEnd} /></td>
              <td className="px-4 py-2 capitalize">{p.status.replace("_", " ")}</td>
              <td className="px-4 py-2 text-right">
                {p.status !== "closed" ? (
                  <button type="button" disabled={busy} onClick={() => handleClose(p.id)} className="text-xs text-red-600 hover:underline disabled:opacity-40">
                    Close
                  </button>
                ) : (
                  <button type="button" disabled={busy} onClick={() => setReopeningId(p.id)} className="text-xs text-amber-600 hover:underline disabled:opacity-40">
                    Reopen
                  </button>
                )}
              </td>
            </tr>
          ))}
          {periods.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                No periods defined yet — all dates are open
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowNew(false)} />
          <div className="relative w-full max-w-sm rounded-lg bg-white p-5 shadow-lg space-y-3">
            <h2 className="text-base font-semibold text-gray-900">New period</h2>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Quick fill from {calendar === "BS" ? "BS" : "calendar"} month</label>
              <select
                defaultValue=""
                onChange={(e) => {
                  const m = months[Number(e.target.value)];
                  if (!m) return;
                  setLabel(m.label);
                  setPeriodStart(m.from);
                  setPeriodEnd(m.to);
                }}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">Choose a month…</option>
                {months.map((m, i) => (
                  <option key={m.from} value={i}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Label</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Ashadh 2082" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Start</label>
                <DatePicker value={periodStart} onChange={(v) => setPeriodStart(v)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">End</label>
                <DatePicker value={periodEnd} onChange={(v) => setPeriodEnd(v)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowNew(false)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={handleCreate} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50">
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {reopeningId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setReopeningId(null)} />
          <div className="relative w-full max-w-sm rounded-lg bg-white p-5 shadow-lg space-y-3">
            <h2 className="text-base font-semibold text-gray-900">Reopen period</h2>
            <p className="text-xs text-gray-500">Admin-only. Recorded with your name, the time, and this reason.</p>
            <textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} rows={3} placeholder="Reason for reopening" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setReopeningId(null)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !reopenReason.trim()}
                onClick={handleReopen}
                className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
              >
                Reopen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
