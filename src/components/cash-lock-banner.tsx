"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useProblem } from "@/components/problem-dialog";
import { D } from "@/components/calendar/date-text";
import type { CashLockInfo } from "@/lib/ledger/cash-reconcile";
import { reopenCashReconciliationAction } from "@/app/(app)/bank-reconciliation/cash-actions";

/**
 * Shown on a document whose cash line was ticked in a cash reconciliation: its amounts, date and payment account are locked and it can't be voided.
 * An owner or administrator can unlock it, which reopens that reconciliation and every later one of the account.
 */
export function CashLockBanner({ lock, onUnlocked }: { lock: CashLockInfo; onUnlocked: () => void }) {
  const { report, dialog } = useProblem();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function unlock() {
    if (!reason.trim()) return report("Say why it is being unlocked.", null);
    setBusy(true);
    try {
      await reopenCashReconciliationAction({ reconId: lock.reconId, bankAccountId: lock.bankAccountId, reason });
      setOpen(false);
      onUnlocked();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not unlock", null);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--warning-text)]">
        <p>
          Locked: this was reconciled in {lock.accountName} up to <D value={lock.asOf} style="long" />. Its amounts, date, category and payment account can&apos;t change and it can&apos;t be voided. You can still change the description and invoice details.
          {!lock.canUnlock && " Ask an administrator to unlock it."}
        </p>
        {lock.canUnlock && (
          <Button size="sm" onClick={() => setOpen(true)}>
            Unlock
          </Button>
        )}
      </div>

      {open && (
        <Modal
          title="Unlock this reconciled entry"
          description={`This reopens ${lock.reopens.length === 1 ? "the reconciliation" : `${lock.reopens.length} reconciliations`} of ${lock.accountName}, newest first. The entries that were ticked are remembered, so you can tick them again after the change.`}
          onClose={() => setOpen(false)}
          dismissible={!busy}
          footer={
            <>
              <Button onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" onClick={unlock} loading={busy}>
                Unlock
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-[13px] text-ink">
            <ul className="list-inside list-disc text-ink-2">
              {lock.reopens.map((d) => (
                <li key={d}>
                  Reconciled up to <D value={d} style="long" />
                </li>
              ))}
            </ul>
            <Field label="Reason" required>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Why does it need to change?" />
            </Field>
          </div>
          {dialog}
        </Modal>
      )}
      {!open && dialog}
    </>
  );
}
