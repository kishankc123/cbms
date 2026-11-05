"use client";

import { useState, useTransition } from "react";
import { DatePicker } from "@/components/calendar/date-picker";
import { D } from "@/components/calendar/date-text";
import { Button } from "@/components/ui/button";
import { Field, Input, controlClass } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import type { ChequeListRow } from "@/lib/cheques/cheques";
import { clearChequeAction, closeChequeAction } from "./actions";

const money = (n: number) => `Rs ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The bank has paid the cheque: this records the payment, dated the day it cleared.
export function ClearChequeModal({ cheque, today, onClose, onDone }: { cheque: ChequeListRow; today: string; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(cheque.chequeDate <= today ? cheque.chequeDate : today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const r = await clearChequeAction(cheque.id, date);
      if (r.ok) onDone();
      else setError(r.error);
    });
  }

  return (
    <Modal
      title={`Mark cheque ${cheque.chequeNumber} as cleared`}
      onClose={onClose}
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={pending}>
            Mark cleared
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px] text-ink">
        <p>
          The bank paid {money(cheque.amount)} to {cheque.payeeName} from {cheque.bankName}. This records that payment in your books
          {cheque.payeeKind === "supplier" ? ", and settles their bills from the oldest" : ""}.
        </p>
        <Field label="Date it cleared" error={error}>
          <DatePicker value={date} onChange={setDate} min={cheque.chequeDate} max={today} className={`${controlClass} w-full`} />
        </Field>
        <p className="text-xs text-ink-2">
          Cheque dated <D value={cheque.chequeDate} style="short" />. Use the date on your bank statement.
        </p>
      </div>
    </Modal>
  );
}

// A cheque that never cleared is stopped, or came back unpaid (bounced). One that cleared and was then returned has its payment voided.
export function CloseChequeModal({ cheque, how, onClose, onDone }: { cheque: ChequeListRow; how: "stopped" | "bounced"; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const wasCleared = cheque.status === "cleared";

  function save() {
    setError(null);
    start(async () => {
      const r = await closeChequeAction(cheque.id, how, reason);
      if (r.ok) onDone();
      else setError(r.error);
    });
  }

  return (
    <Modal
      title={how === "stopped" ? `Stop cheque ${cheque.chequeNumber}` : wasCleared ? `Cheque ${cheque.chequeNumber} returned by the bank` : `Cheque ${cheque.chequeNumber} bounced`}
      onClose={onClose}
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={save} loading={pending}>
            {how === "stopped" ? "Stop cheque" : "Mark as bounced"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px] text-ink">
        <p>
          {how === "stopped"
            ? `Use this when you have cancelled the cheque with the bank or it was lost. Nothing was posted for it, so your books do not change, and the ${money(cheque.amount)} is no longer promised.`
            : wasCleared
              ? `The payment this cheque made will be voided, so ${cheque.payeeName}'s bills it settled become unpaid again.`
              : `The bank returned the cheque unpaid. Nothing was posted for it, so your books do not change, and the ${money(cheque.amount)} is no longer promised.`}
        </p>
        <Field label="Reason" required error={error}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={how === "stopped" ? "Lost in transit" : "Insufficient funds"} autoFocus />
        </Field>
        <p className="text-xs text-ink-2">The cheque number stays used. To pay the supplier again, re-issue it as a new cheque.</p>
      </div>
    </Modal>
  );
}
