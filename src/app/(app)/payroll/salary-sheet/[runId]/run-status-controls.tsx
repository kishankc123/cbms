"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { advanceRunStatus, revertRunToDraft, generatePayrollRun, reverseFinalizedRun } from "../actions";
import { useProblem } from "@/components/problem-dialog";

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
  calendar,
}: {
  runId: string;
  status: string;
  month: number;
  year: number;
  calendar: "AD" | "BS";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Problems are shown in a dialog that says why.
  const { report, dialog } = useProblem();
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState("");

  async function handleAdvance() {
    setBusy(true);
    try {
      await advanceRunStatus({ runId });
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed", null);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevert() {
    setBusy(true);
    try {
      await revertRunToDraft({ runId });
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed", null);
    } finally {
      setBusy(false);
    }
  }

  async function handleRecalculate() {
    if (!confirm("Recalculate this payroll run from the latest salary, benefits, and attendance records?")) return;
    setBusy(true);
    try {
      await generatePayrollRun({ month, year, calendar, employeeIds: [] });
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed", null);
    } finally {
      setBusy(false);
    }
  }

  async function handleReverse() {
    if (!reason.trim()) return report("Enter the reason for reversing this payroll run.", "[data-reason]");
    setBusy(true);
    try {
      await reverseFinalizedRun({ runId, reason });
      setReversing(false);
      setReason("");
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to reverse the run", null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">{STATUS_LABELS[status]}</span>
      {status === "finalized" && (
        <button
          type="button"
          onClick={() => setReversing(true)}
          disabled={busy}
          className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-3 py-1.5 disabled:opacity-50"
        >
          Reverse run
        </button>
      )}
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
      {reversing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setReversing(false)} />
          <div className="relative w-full max-w-sm space-y-3 rounded-lg bg-white p-5 shadow-lg">
            <h2 className="text-base font-semibold text-gray-900">Reverse this payroll run</h2>
            <p className="text-xs text-gray-500">Its salary entry is reversed and the run goes back to draft so it can be corrected and finalized again. Not possible once an employee has been paid out of it.</p>
            <textarea
              data-reason
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for reversing"
              rows={3}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReversing(false)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={handleReverse} className="rounded bg-red-600 px-4 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50">
                Reverse
              </button>
            </div>
          </div>
        </div>
      )}
      {dialog}
    </div>
  );
}
