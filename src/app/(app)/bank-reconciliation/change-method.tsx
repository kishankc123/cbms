"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { ReconcileMethod } from "@/lib/ledger/cash-reconcile-rules";
import { setReconcileMethodAction } from "./actions";

const CHOICES: { value: ReconcileMethod; title: string; text: string }[] = [
  { value: "statement", title: "Match a bank statement", text: "Upload the statement and match its lines with your books. This is the usual way for a bank account." },
  { value: "ticking", title: "Tick entries and confirm the balance", text: "For when a statement can't be uploaded. Tick the entries you have checked against your bank's app or passbook, then confirm the closing balance. You can enter the bank's balance as proof." },
];

/** Lets a person choose how a bank account is reconciled. The link takes the shape of the screen it sits on; after a change it opens the other screen. */
export function ChangeMethod({ bankAccountId, label, method, className, stay, onChanged, text = "Change method" }: { bankAccountId: string; label: string; method: ReconcileMethod; className?: string; /** Stay on this screen after a change instead of opening the account's reconciliation screen. */ stay?: boolean; onChanged?: (method: ReconcileMethod) => void; text?: string }) {
  const router = useRouter();
  const toast = useToast();
  const { report, dialog } = useProblem();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ReconcileMethod>(method);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const r = await setReconcileMethodAction({ bankAccountId, method: choice });
      setOpen(false);
      if (r.changed) toast.success(choice === "ticking" ? "This account is now reconciled by ticking entries." : "This account is now reconciled against its bank statement.");
      onChanged?.(choice);
      if (!stay) router.push(choice === "ticking" ? `/bank-reconciliation/${bankAccountId}/cash` : `/bank-reconciliation/${bankAccountId}`);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not change the method", null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={className ?? "text-xs font-medium text-accent-text hover:underline"}
        onClick={() => {
          setChoice(method);
          setOpen(true);
        }}
      >
        {text}
      </button>
      {open && (
        <Modal
          title="How is this account reconciled?"
          description={label}
          onClose={() => setOpen(false)}
          dismissible={!busy}
          footer={
            <>
              <Button onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" onClick={save} loading={busy} disabled={choice === method}>
                Use this method
              </Button>
            </>
          }
        >
          <div className="space-y-2">
            {CHOICES.map((c) => (
              <label key={c.value} className={`flex cursor-pointer gap-2.5 rounded-lg border p-3 text-[13px] ${choice === c.value ? "border-accent bg-surface-2" : "border-line"}`}>
                <input type="radio" name="reconcile-method" className="mt-0.5" checked={choice === c.value} onChange={() => setChoice(c.value)} />
                <span>
                  <span className="block font-medium text-ink">{c.title}</span>
                  <span className="block text-xs text-ink-2">{c.text}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-2">
            {choice === "ticking"
              ? "Entries already matched to a statement stay reconciled, and the ticking screen starts from them. Only entries not yet matched are offered to tick."
              : "Entries already ticked stay reconciled and locked, and the history of both is kept."}{" "}
            You can change this again at any time, except while a statement reconciliation is half done.
          </p>
          {dialog}
        </Modal>
      )}
    </>
  );
}
