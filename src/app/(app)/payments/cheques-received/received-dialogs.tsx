"use client";

import { useEffect, useState, useTransition } from "react";
import { DatePicker } from "@/components/calendar/date-picker";
import { D } from "@/components/calendar/date-text";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, controlClass } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import type { ReceivedListRow } from "@/lib/cheques/received";
import type { ReceivedInput } from "@/lib/cheques/received-rules";
import { clearReceivedAction, closeReceivedAction, depositChequeAction, getCustomerPreview, getReceivedFormData, receiveChequeAction } from "./actions";

const money = (n: number) => `Rs ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type FormData = Awaited<ReturnType<typeof getReceivedFormData>>;
type Preview = Awaited<ReturnType<typeof getCustomerPreview>>;

// Recording a cheque a customer has just handed over. Beside the form: which of their invoices it would settle once it clears.
export function ReceiveChequeModal({ today, onClose, onSaved }: { today: string; onClose: () => void; onSaved: () => void }) {
  const [data, setData] = useState<FormData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [drawerBank, setDrawerBank] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [receivedDate, setReceivedDate] = useState(today);
  const [chequeDate, setChequeDate] = useState(today);
  const [memo, setMemo] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    getReceivedFormData()
      .then((d) => live && setData(d))
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const amountNum = Number(amount);
  useEffect(() => {
    if (!customerId) return;
    let live = true;
    const t = setTimeout(() => {
      getCustomerPreview(customerId, Number.isFinite(amountNum) ? amountNum : 0)
        .then((p) => live && setPreview(p))
        .catch(() => live && setPreview(null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [customerId, amountNum]);
  const shown = customerId ? preview : null;

  function save() {
    setError(null);
    const input: ReceivedInput = { customerId, drawerBank, chequeNumber, amount: amountNum, receivedDate, chequeDate, memo: memo || null };
    start(async () => {
      const r = await receiveChequeAction(input);
      if (r.ok) onSaved();
      else setError(r.error);
    });
  }

  const postDated = chequeDate > today;

  return (
    <Modal
      size="xl"
      title="Receive a cheque"
      description="This records the cheque in the register. Nothing is posted to your books until the bank pays it."
      onClose={onClose}
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={pending} disabled={!data}>
            Save cheque
          </Button>
        </>
      }
    >
      {loadFailed ? (
        <p className="text-[13px] text-[var(--danger-text)]">The form could not be loaded. Close it and try again.</p>
      ) : !data ? (
        <p className="py-6 text-center text-[13px] text-ink-2">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Customer" required className="sm:col-span-2">
                <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Select customer</option>
                  {data.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Drawn on (their bank)" required>
                <Input value={drawerBank} onChange={(e) => setDrawerBank(e.target.value)} placeholder="Nabil Bank" />
              </Field>
              <Field label="Cheque number" required>
                <Input value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} className="font-mono" />
              </Field>
              <Field label="Received on">
                <DatePicker value={receivedDate} onChange={setReceivedDate} max={today} className={`${controlClass} w-full`} />
              </Field>
              <Field label="Date on the cheque" required hint={postDated ? "Post-dated: it cannot be deposited before this day." : "Dated today or earlier: it can be deposited now."}>
                <DatePicker value={chequeDate} onChange={setChequeDate} className={`${controlClass} w-full`} />
              </Field>
              <Field label="Amount" required>
                <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-right" />
              </Field>
              <Field label="Note">
                <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional" />
              </Field>
            </div>
            {error && <p className="text-[13px] text-[var(--danger-text)]">{error}</p>}
          </div>

          <aside className="h-fit rounded-lg border border-line bg-surface-2 p-3 text-[13px]" aria-live="polite">
            <p className="mb-1.5 font-semibold text-ink">What it would settle once it clears</p>
            {!customerId ? (
              <p className="text-xs text-ink-2">Choose a customer to see their open invoices.</p>
            ) : !shown ? (
              <p className="text-xs text-ink-2">Looking up their invoices…</p>
            ) : shown.owed <= 0 ? (
              <p className="text-xs text-ink-2">This customer has no open invoices. The money would be kept as an advance from them.</p>
            ) : (
              <>
                <p className="text-xs text-ink-2">They owe {money(shown.owed)} on open invoices.</p>
                {shown.settles.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-xs">
                    {shown.settles.map((s) => (
                      <li key={s.number} className="flex justify-between gap-2">
                        <span className="text-ink-2">
                          {s.number} {s.full ? "paid in full" : "part-paid"}
                        </span>
                        <span className="tnum text-ink">{money(s.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {shown.advance > 0 && <p className="mt-1 text-xs text-ink-2">{money(shown.advance)} more than they owe stays with them as an advance.</p>}
              </>
            )}
            <p className="mt-3 border-t border-line pt-2 text-xs text-ink-2">Until it clears, the invoices stay unpaid. Your cash forecast counts the cheque as money coming in on its date.</p>
          </aside>
        </div>
      )}
    </Modal>
  );
}

// The cheque has been handed to the bank. Nothing is posted yet.
export function DepositModal({ cheque, today, onClose, onDone }: { cheque: ReceivedListRow; today: string; onClose: () => void; onDone: () => void }) {
  const [banks, setBanks] = useState<FormData["banks"] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    getReceivedFormData()
      .then((d) => {
        if (!live) return;
        setBanks(d.banks);
        setAccountId((cur) => cur || d.banks[0]?.id || "");
      })
      .catch(() => live && setError("The bank accounts could not be loaded."));
    return () => {
      live = false;
    };
  }, []);

  function save() {
    setError(null);
    start(async () => {
      const r = await depositChequeAction(cheque.id, accountId, date);
      if (r.ok) onDone();
      else setError(r.error);
    });
  }

  return (
    <Modal
      title={`Deposit cheque ${cheque.chequeNumber}`}
      onClose={onClose}
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={pending} disabled={!banks || !accountId}>
            Mark deposited
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px] text-ink">
        <p>
          {money(cheque.amount)} from {cheque.payerName}, drawn on {cheque.drawerBank}. Nothing is posted until the bank clears it. This only records which of your accounts it went into.
        </p>
        <Field label="Deposited into" required>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={!banks}>
            {(banks ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date deposited" error={error}>
          <DatePicker value={date} onChange={setDate} min={cheque.chequeDate} max={today} className={`${controlClass} w-full`} />
        </Field>
      </div>
    </Modal>
  );
}

// The bank has paid the cheque: this records the receipt, dated the day it cleared.
export function ClearReceivedModal({ cheque, today, onClose, onDone }: { cheque: ReceivedListRow; today: string; onClose: () => void; onDone: () => void }) {
  const floor = cheque.depositedDate && cheque.depositedDate > cheque.chequeDate ? cheque.depositedDate : cheque.chequeDate;
  const [date, setDate] = useState(floor <= today ? floor : today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const r = await clearReceivedAction(cheque.id, cheque.depositAccountId, date);
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
          The bank paid {money(cheque.amount)} from {cheque.payerName} into {cheque.depositBank ?? "your account"}. This records the receipt in your books and settles their invoices from the oldest.
        </p>
        <Field label="Date it cleared" error={error}>
          <DatePicker value={date} onChange={setDate} min={floor} max={today} className={`${controlClass} w-full`} />
        </Field>
        <p className="text-xs text-ink-2">
          Cheque dated <D value={cheque.chequeDate} style="short" />. Use the date on your bank statement.
        </p>
      </div>
    </Modal>
  );
}

// A cheque held and given back (returned), or one the bank sent back unpaid (bounced). One that had cleared has its receipt voided.
export function CloseReceivedModal({ cheque, how, onClose, onDone }: { cheque: ReceivedListRow; how: "bounced" | "returned"; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const wasCleared = cheque.status === "cleared";

  function save() {
    setError(null);
    start(async () => {
      const r = await closeReceivedAction(cheque.id, how, reason);
      if (r.ok) onDone();
      else setError(r.error);
    });
  }

  return (
    <Modal
      title={how === "returned" ? `Give back cheque ${cheque.chequeNumber}` : wasCleared ? `Cheque ${cheque.chequeNumber} returned by the bank` : `Cheque ${cheque.chequeNumber} bounced`}
      onClose={onClose}
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={save} loading={pending}>
            {how === "returned" ? "Give back" : "Mark as bounced"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px] text-ink">
        <p>
          {how === "returned"
            ? `Use this when you hand the cheque back to ${cheque.payerName}. Nothing was posted for it, so your books do not change, and the ${money(cheque.amount)} is no longer expected.`
            : wasCleared
              ? `The receipt this cheque made will be voided, so ${cheque.payerName}'s invoices it settled become unpaid again.`
              : `The bank sent the cheque back unpaid. Nothing was posted for it, so your books do not change, and the ${money(cheque.amount)} is no longer expected. The customer still owes it.`}
        </p>
        <Field label="Reason" required error={error}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={how === "returned" ? "Customer paid in cash instead" : "Insufficient funds"} autoFocus />
        </Field>
      </div>
    </Modal>
  );
}
