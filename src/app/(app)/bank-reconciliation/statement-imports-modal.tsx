"use client";

import { useEffect, useState } from "react";
import { useProblem } from "@/components/problem-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/status-pill";
import { D } from "@/components/calendar/date-text";
import type { StatementImportRow } from "@/lib/banking/statement-imports";
import { deleteStatementImportAction, listStatementImportsAction } from "./actions";

/** The statements uploaded for an account, each with a Delete when nothing in it is matched, so a wrong upload can be removed and uploaded again. */
export function StatementImportsModal({ bankAccountId, onClose, onChanged }: { bankAccountId: string; onClose: () => void; onChanged: () => void }) {
  const ask = useConfirm();
  const toast = useToast();
  const { report, dialog } = useProblem();
  const [rows, setRows] = useState<StatementImportRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function reload() {
    try {
      setRows(await listStatementImportsAction(bankAccountId));
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not load the statements", null);
      setRows([]);
    }
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankAccountId]);

  async function remove(r: StatementImportRow) {
    const name = r.fileName ?? "this statement";
    if (!(await ask(`Delete ${name}? Its ${r.rows} ${r.rows === 1 ? "line is" : "lines are"} removed from the reconciliation so you can upload a corrected file. Your books are not changed.`, { confirmLabel: "Delete statement", danger: true }))) return;
    setBusy(r.id);
    try {
      await deleteStatementImportAction({ importId: r.id });
      toast.success("Statement deleted. You can upload the corrected file now.");
      await reload();
      onChanged();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not delete the statement", null);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title="Uploaded statements" description="Delete a statement that was uploaded wrongly, then upload it again. A statement with matched lines must be unmatched first." size="lg" onClose={onClose}>
      {rows === null ? (
        <p className="text-sm text-ink-2">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-2">No statement has been uploaded for this account.</p>
      ) : (
        <table className="w-full border-collapse text-[13px]">
          <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
            <tr>
              <th className="px-2.5 py-1.5 font-medium">File</th>
              <th className="px-2.5 py-1.5 font-medium">Dates covered</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Lines</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Matched</th>
              <th className="px-2.5 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line align-top">
                <td className="px-2.5 py-1.5">
                  <p className="font-medium">{r.fileName ?? "Statement"}</p>
                  <p className="text-xs text-ink-2">
                    Uploaded <D value={r.uploadedAt.slice(0, 10)} />
                  </p>
                </td>
                <td className="px-2.5 py-1.5">
                  <D value={r.periodStart} /> – <D value={r.periodEnd} />
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{r.rows}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{r.matched}</td>
                <td className="px-2.5 py-1.5 text-right">
                  {r.blockedBecause ? (
                    <div className="space-y-1">
                      <StatusPill tone="pending">Can&apos;t delete yet</StatusPill>
                      <p className="max-w-56 text-xs text-ink-2">{r.blockedBecause}</p>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" loading={busy === r.id} onClick={() => remove(r)}>
                      Delete
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {dialog}
    </Modal>
  );
}
