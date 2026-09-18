"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { advanceRunStatus, revertRunToDraft, generatePayrollRun } from "../actions";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  review: "Review",
  approved: "Approved",
  finalized: "Finalized",
};

const NEXT_ACTION: Record<string, string> = {
  draft: "Send for review",
  review: "Approve",
  approved: "Finalize",
};

export function RunStatusControls({
  runId,
  status,
  month,
  year,
}: {
  runId: string;
  status: string;
  month: number;
  year: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdvance() {
    setError(null);
    setBusy(true);
    try {
      await advanceRunStatus({ runId });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevert() {
    setError(null);
    setBusy(true);
    try {
      await revertRunToDraft({ runId });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRecalculate() {
    setError(null);
    if (!confirm("Recalculate this payroll run from the latest salary, benefits, and attendance records?")) return;
    setBusy(true);
    try {
      await generatePayrollRun({ month, year, employeeIds: [] });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">{STATUS_LABELS[status]}</span>
      {error && <span className="text-xs text-red-600">{error}</span>}
      {status !== "finalized" && (
        <>
          <button
            type="button"
            onClick={handleRecalculate}
            disabled={busy}
            className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-3 py-1.5 disabled:opacity-50"
          >
            Recalculate
          </button>
          {status !== "draft" && (
            <button
              type="button"
              onClick={handleRevert}
              disabled={busy}
              className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-3 py-1.5 disabled:opacity-50"
            >
              Revert to draft
            </button>
          )}
          <button
            type="button"
            onClick={handleAdvance}
            disabled={busy}
            className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
          >
            {busy ? "Working..." : NEXT_ACTION[status]}
          </button>
        </>
      )}
    </div>
  );
}
