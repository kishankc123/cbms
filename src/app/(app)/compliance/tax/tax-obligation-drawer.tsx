"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getTaxObligationDetail,
  getTaxActionOptions,
  updateTaxObligation,
  recordObligationPayment,
  recordTaxCharge,
  voidTaxCharge,
  type ObligationPatch,
} from "../tax-actions";
import { updateCalendarItemStatus } from "../actions";
import type { ObligationStatus } from "@/lib/compliance/engine/status";
import { ObligationStatusPill } from "@/components/compliance/status-pill";
import { D } from "@/components/calendar/date-text";
import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";

type Detail = Awaited<ReturnType<typeof getTaxObligationDetail>>;
type Options = Awaited<ReturnType<typeof getTaxActionOptions>>;

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });
const input = "w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50";
const STATUSES: ObligationStatus[] = ["pending", "in_progress", "filed", "paid", "partially_paid", "not_applicable"];
const STATUS_LABEL: Record<ObligationStatus, string> = { pending: "Pending", in_progress: "In progress", filed: "Filed", paid: "Paid", partially_paid: "Partially paid", not_applicable: "Not applicable" };
const KIND_LABEL = { assessment: "Assessment", penalty: "Penalty / fine", interest: "Interest" } as const;

export function TaxObligationDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<ObligationPatch | null>(null);
  const [panel, setPanel] = useState<"none" | "payment" | "charge">("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getTaxObligationDetail(id);
      setDetail(d);
      setForm({
        filingDate: d.item.filingDate,
        paymentDueDate: d.item.paymentDueDate,
        filingReference: d.item.filingReference,
        paymentReference: d.item.paymentReference,
        supportingDocument: d.item.supportingDocument,
        notes: d.item.notes,
        responsibleUserId: d.item.responsibleUserId,
        enteredAmount: d.item.enteredAmount,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: ObligationStatus) {
    let reason: string | undefined;
    if (status === "not_applicable") {
      reason = window.prompt("Why is this not applicable?")?.trim();
      if (!reason) return;
    }
    await run(() => updateCalendarItemStatus({ itemId: id, status, reason }));
  }

  async function openPanel(next: "payment" | "charge") {
    setPanel(next);
    if (!options) setOptions(await getTaxActionOptions());
  }

  const d = detail;
  const set = (patch: Partial<ObligationPatch>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const canAct = d?.canEdit && d.item.status !== "not_applicable";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-lg space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{d ? `${d.item.name} — ${d.item.period}` : "Compliance item"}</h2>
            {d && (
              <p className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                <ObligationStatusPill status={d.item.effective} />
                <span>
                  Due <D value={d.item.dueDate} />
                </span>
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        {loadError && <p className="text-sm text-red-600">{loadError}</p>}
        {!d && !loadError && <p className="text-sm text-gray-500">Loading...</p>}

        {d && form && (
          <>
            {d.item.status === "not_applicable" && <p className="rounded bg-gray-50 px-3 py-2 text-xs text-gray-600">Marked not applicable: {d.item.notApplicableReason}</p>}

            <section className="rounded-lg border border-gray-200 p-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-500">Amount due</p>
                  <p className="text-lg font-semibold text-gray-900">{fmt(d.amounts.due)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Paid</p>
                  <p className="text-lg font-semibold text-gray-900">{fmt(d.amounts.paid)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Balance</p>
                  <p className={`text-lg font-semibold ${d.amounts.balance > 0.005 ? "text-amber-700" : "text-gray-900"}`}>{fmt(d.amounts.balance)}</p>
                </div>
              </div>
              <dl className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500">
                {d.amounts.computedDue !== null && (
                  <div className="flex justify-between">
                    <dt>From your books for this period</dt>
                    <dd>{fmt(d.amounts.computedDue)}</dd>
                  </div>
                )}
                {d.amounts.computedDue === null && d.amounts.entered !== null && (
                  <div className="flex justify-between">
                    <dt>Entered amount</dt>
                    <dd>{fmt(d.amounts.entered)}</dd>
                  </div>
                )}
                {d.amounts.assessed > 0 && (
                  <div className="flex justify-between">
                    <dt>Assessments, penalties and interest</dt>
                    <dd>{fmt(d.amounts.assessed)}</dd>
                  </div>
                )}
              </dl>
            </section>

            {canAct && (
              <div className="flex flex-wrap items-center gap-2">
                <select value={d.item.status} disabled={busy} onChange={(e) => changeStatus(e.target.value as ObligationStatus)} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                {d.item.status !== "filed" && d.item.status !== "paid" && (
                  <button type="button" disabled={busy} onClick={() => changeStatus("filed")} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    Mark as filed
                  </button>
                )}
                {d.canPay && d.item.hasPayableAccount && (
                  <button type="button" disabled={busy} onClick={() => openPanel("payment")} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-3 py-1.5 disabled:opacity-50">
                    Record payment
                  </button>
                )}
                {d.item.hasPayableAccount && (
                  <button type="button" disabled={busy} onClick={() => openPanel("charge")} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    Add penalty / assessment
                  </button>
                )}
              </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}

            {panel === "payment" && options && (
              <PaymentPanel
                balance={d.amounts.balance}
                options={options}
                busy={busy}
                onCancel={() => setPanel("none")}
                onSubmit={(v) =>
                  run(async () => {
                    const r = await recordObligationPayment({ obligationId: id, ...v });
                    if (r.duplicateWarning) {
                      if (!window.confirm("A very similar payment was recorded recently. Record this one anyway?")) return;
                      await recordObligationPayment({ obligationId: id, ...v, confirmDuplicate: true });
                    }
                    setPanel("none");
                  })
                }
              />
            )}
            {panel === "charge" && options && (
              <ChargePanel
                taxTypeName={d.item.taxTypeName}
                options={options}
                busy={busy}
                onCancel={() => setPanel("none")}
                onSubmit={(v) =>
                  run(async () => {
                    await recordTaxCharge({ obligationId: id, taxTypeKey: d.item.taxTypeKey, ...v });
                    setPanel("none");
                  })
                }
              />
            )}

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-900">Filing and payment details</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Filing date</label>
                  <DatePicker value={form.filingDate} onChange={(v) => set({ filingDate: v })} disabled={!d.canEdit} className={input} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Payment due date</label>
                  <DatePicker value={form.paymentDueDate} onChange={(v) => set({ paymentDueDate: v })} disabled={!d.canEdit} className={input} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Filing reference</label>
                  <input className={input} value={form.filingReference} onChange={(e) => set({ filingReference: e.target.value })} disabled={!d.canEdit} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Payment reference</label>
                  <input className={input} value={form.paymentReference} onChange={(e) => set({ paymentReference: e.target.value })} disabled={!d.canEdit} />
                </div>
                {d.amounts.computedDue === null && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Amount due (entered)</label>
                    <input type="number" step="0.01" min="0" className={input} value={form.enteredAmount ?? ""} onChange={(e) => set({ enteredAmount: e.target.value })} disabled={!d.canEdit} />
                  </div>
                )}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Responsible</label>
                  <select className={input} value={form.responsibleUserId} onChange={(e) => set({ responsibleUserId: e.target.value })} disabled={!d.canEdit}>
                    <option value="">Unassigned</option>
                    {d.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Supporting document (reference)</label>
                  <input className={input} value={form.supportingDocument} onChange={(e) => set({ supportingDocument: e.target.value })} disabled={!d.canEdit} placeholder="Link or file name" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Notes</label>
                  <textarea rows={2} className={input} value={form.notes} onChange={(e) => set({ notes: e.target.value })} disabled={!d.canEdit} />
                </div>
              </div>
              {d.canEdit && (
                <div className="flex justify-end">
                  <button type="button" disabled={busy} onClick={() => run(() => updateTaxObligation(id, form))} className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    Save details
                  </button>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-900">Payments</h3>
              {d.payments.length === 0 ? (
                <p className="text-xs text-gray-400">No payments recorded against this item.</p>
              ) : (
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm">
                  {d.payments.map((p) => (
                    <li key={p.paymentId} className="flex items-center justify-between px-3 py-2">
                      <span className={p.voided ? "text-gray-400 line-through" : ""}>
                        <span className="font-mono text-xs">{p.number}</span> · <D value={p.date} />
                        {p.reference && <span className="ml-1 text-xs text-gray-400">({p.reference})</span>}
                      </span>
                      <span className={p.voided ? "text-gray-400 line-through" : "font-medium"}>{fmt(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-900">Assessments, penalties and interest</h3>
              {d.charges.length === 0 ? (
                <p className="text-xs text-gray-400">None recorded.</p>
              ) : (
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm">
                  {d.charges.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className={c.status === "voided" ? "text-gray-400 line-through" : ""}>
                        {KIND_LABEL[c.kind]} · <D value={c.date} />
                        {c.description && <span className="ml-1 text-xs text-gray-400">{c.description}</span>}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className={c.status === "voided" ? "text-gray-400 line-through" : "font-medium"}>{fmt(c.amount)}</span>
                        {c.status === "posted" && d.canEdit && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              const reason = window.prompt("Reason for voiding this charge?")?.trim();
                              if (reason) run(() => voidTaxCharge(c.id, reason));
                            }}
                            className="text-xs text-red-600 hover:underline disabled:opacity-40"
                          >
                            Void
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function PaymentPanel({
  balance,
  options,
  busy,
  onCancel,
  onSubmit,
}: {
  balance: number;
  options: Options;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (v: { amount: number; paymentDate: string; accountId: string; paymentMethod: "cash" | "bank_transfer" | "cheque" | "card" | "online" | "other"; referenceNumber: string; chequeNumber?: string }) => void;
}) {
  const [amount, setAmount] = useState(balance > 0 ? balance.toFixed(2) : "");
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [accountId, setAccountId] = useState(options.cashBank[0]?.id ?? "");
  const [method, setMethod] = useState<"cash" | "bank_transfer" | "cheque" | "card" | "online" | "other">("bank_transfer");
  const [reference, setReference] = useState("");
  const [cheque, setCheque] = useState("");
  const value = Number(amount);

  return (
    <section className="space-y-3 rounded-lg border border-[var(--color-primary)]/30 bg-blue-50/30 p-4">
      <h3 className="text-sm font-semibold text-gray-900">Record payment</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Amount</label>
          <input type="number" step="0.01" min="0" className={input} value={amount} onChange={(e) => setAmount(e.target.value)} />
          {balance > 0 && <p className="mt-1 text-xs text-gray-400">Balance {fmt(balance)}</p>}
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Date</label>
          <DatePicker value={paymentDate} onChange={setPaymentDate} className={input} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Paid from</label>
          <select className={input} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {options.cashBank.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Method</label>
          <select className={input} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="bank_transfer">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="cheque">Cheque</option>
            <option value="online">Online</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
          </select>
        </div>
        {method === "cheque" && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Cheque number</label>
            <input className={input} value={cheque} onChange={(e) => setCheque(e.target.value)} />
          </div>
        )}
        <div className={method === "cheque" ? "" : "col-span-2"}>
          <label className="block text-xs text-gray-500 mb-1">Payment reference</label>
          <input className={input} value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !(value > 0) || !accountId || !paymentDate}
          onClick={() => onSubmit({ amount: value, paymentDate, accountId, paymentMethod: method, referenceNumber: reference, chequeNumber: cheque || undefined })}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
        >
          {busy ? "Recording..." : "Record payment"}
        </button>
      </div>
    </section>
  );
}

function ChargePanel({
  taxTypeName,
  options,
  busy,
  onCancel,
  onSubmit,
}: {
  taxTypeName: string;
  options: Options;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (v: { kind: "assessment" | "penalty" | "interest"; amount: number; date: string; description: string; reference: string; expenseAccountId: string }) => void;
}) {
  const [kind, setKind] = useState<"assessment" | "penalty" | "interest">("penalty");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const value = Number(amount);

  return (
    <section className="space-y-3 rounded-lg border border-gray-300 bg-gray-50/60 p-4">
      <h3 className="text-sm font-semibold text-gray-900">Add penalty / assessment</h3>
      <p className="text-xs text-gray-500">Adds to what you owe for {taxTypeName} and posts to your books: expense on one side, {taxTypeName} payable on the other.</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Type</label>
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Amount</label>
          <input type="number" step="0.01" min="0" className={input} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Date</label>
          <DatePicker value={date} onChange={setDate} className={input} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Reference</label>
          <input className={input} value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Charge to expense account</label>
          <select className={input} value={expenseAccountId} onChange={(e) => setExpenseAccountId(e.target.value)}>
            <option value="">Tax Fines & Penalties (default)</option>
            {options.expense.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Description</label>
          <input className={input} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !(value > 0) || !date}
          onClick={() => onSubmit({ kind, amount: value, date, description, reference, expenseAccountId })}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
        >
          {busy ? "Posting..." : "Post to ledger"}
        </button>
      </div>
    </section>
  );
}
