"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useProblem } from "@/components/problem-dialog";
import { leaveEmployeeOutOfRun, putEmployeeBackInRun } from "../actions";

/** Leaves one employee out of this draft; the run is worked out again without them. */
export function LeaveOutButton({ runId, employeeId, name }: { runId: string; employeeId: string; name: string }) {
  const router = useRouter();
  const ask = useConfirm();
  const { report, dialog } = useProblem();
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!(await ask(`Leave ${name} out of this run? The run is worked out again without them, and you can put them back from the list under the table.`, { confirmLabel: "Leave out" }))) return;
    setBusy(true);
    try {
      await leaveEmployeeOutOfRun({ runId, employeeId });
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not leave them out", null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" onClick={go} disabled={busy} className="ml-3 text-xs text-ink-2 hover:text-[var(--danger-text)] hover:underline disabled:opacity-50">
        Leave out
      </button>
      {dialog}
    </>
  );
}

export type NotInRun = { id: string; name: string; code: string; reason: string | null };

/** Employees who are not in this draft: the ones left out on purpose can be put back; for the others it says what to fix on their profile. */
export function NotInRunPanel({ runId, people, canEdit }: { runId: string; people: NotInRun[]; canEdit: boolean }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [busy, setBusy] = useState<string | null>(null);
  if (people.length === 0) return null;

  async function putBack(id: string) {
    setBusy(id);
    try {
      await putEmployeeBackInRun({ runId, employeeId: id });
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not add them", null);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">Not in this run ({people.length})</h2>
      <p className="mt-0.5 text-xs text-ink-2">Everyone employed in the month is included on their own. These are not, and why.</p>
      <ul className="mt-2 divide-y divide-line">
        {people.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
            <span>
              <span className="font-mono text-xs text-ink-2">{p.code}</span> {p.name}
              <span className="ml-2 text-xs text-ink-2">{p.reason ?? "Left out of this run"}</span>
            </span>
            {canEdit && p.reason === null && (
              <Button variant="secondary" size="sm" onClick={() => putBack(p.id)} loading={busy === p.id}>
                Add to run
              </Button>
            )}
          </li>
        ))}
      </ul>
      {dialog}
    </div>
  );
}
