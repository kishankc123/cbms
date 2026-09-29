"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
import { pauseRecurringExpense, resumeRecurringExpense, stopRecurringExpense } from "./actions";
import type { RecurringStatus } from "@/lib/recurring-expenses/schedule";

const inputClass = "w-full rounded border border-[var(--card-border)] bg-[var(--card-bg)] px-2 py-1.5 text-sm text-[var(--text-primary)]";

function MiniModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-lg bg-[var(--card-bg)] p-4 shadow-lg space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function LifecycleActions({ id, status }: { id: string; status: RecurringStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [resumeFrom, setResumeFrom] = useState(todayIso());
  const [stopEffective, setStopEffective] = useState(todayIso());

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
      setResuming(false);
      setStopping(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-3 text-xs">
      {error && <span className="text-[var(--status-critical-text)]">{error}</span>}
      {status === "active" && (
        <button type="button" disabled={busy} onClick={() => run(() => pauseRecurringExpense(id))} className="font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          Pause
        </button>
      )}
      {status === "paused" && (
        <button type="button" onClick={() => setResuming(true)} className="font-medium text-[var(--color-primary)] hover:underline">
          Resume
        </button>
      )}
      {status !== "stopped" && (
        <button type="button" onClick={() => setStopping(true)} className="font-medium text-[var(--status-critical-text)] hover:underline">
          Stop
        </button>
      )}

      {resuming && (
        <MiniModal title="Resume recurring expense" onClose={() => setResuming(false)}>
          <p className="text-xs text-[var(--text-secondary)]">Recurrence picks back up from this date — nothing is generated for the paused period.</p>
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">Resume date</label>
            <DatePicker value={resumeFrom} onChange={setResumeFrom} className={inputClass} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setResuming(false)} className="rounded border border-[var(--card-border)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={() => run(() => resumeRecurringExpense(id, resumeFrom))} className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-xs text-white">
              Resume
            </button>
          </div>
        </MiniModal>
      )}

      {stopping && (
        <MiniModal title="Stop recurring expense" onClose={() => setStopping(false)}>
          <p className="text-xs text-[var(--text-secondary)]">
            Existing transactions and unpaid liabilities are untouched. No new recurrence is generated on or after the effective date. This can&apos;t be undone from here.
          </p>
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">Effective date</label>
            <DatePicker value={stopEffective} onChange={setStopEffective} className={inputClass} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setStopping(false)} className="rounded border border-[var(--card-border)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => stopRecurringExpense(id, stopEffective))}
              className="rounded bg-[var(--status-critical-text)] px-3 py-1.5 text-xs text-white"
            >
              Stop recurring expense
            </button>
          </div>
        </MiniModal>
      )}
    </div>
  );
}
