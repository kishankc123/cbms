"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { DatePicker } from "@/components/calendar/date-picker";
import { D } from "@/components/calendar/date-text";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, controlClass } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/status-pill";
import { addDays, type ForecastDay } from "@/lib/dashboard/forecast-rules";
import { positionOf, rollForward, safestDate, type EventDraft } from "@/lib/dashboard/planning-rules";
import type { ChequeListRow } from "@/lib/cheques/cheques";
import type { ChequeInput, PayeeKind } from "@/lib/cheques/cheque-rules";
import { getChequeFormData, getFundingOutlook, getNextChequeNumber, getSupplierPreview, issueChequeAction } from "./actions";

import { AmountInput } from "@/components/ui/amount-input";
const money = (n: number) => `Rs ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type FormData = Awaited<ReturnType<typeof getChequeFormData>>;
type Outlook = Awaited<ReturnType<typeof getFundingOutlook>>;
type Preview = Awaited<ReturnType<typeof getSupplierPreview>>;

// Writing a cheque into the register. Beside the form, the forecast shows what the cheque does to cash on the day it can be presented,
// so a cheque that would not be covered is seen before it is handed over.
export function IssueChequeModal({ replacing, today, onClose, onSaved }: { replacing: ChequeListRow | null; today: string; onClose: () => void; onSaved: () => void }) {
  const [data, setData] = useState<FormData | null>(null);
  const [outlook, setOutlook] = useState<{ key: string; data: Outlook } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [bankAccountId, setBankAccountId] = useState(replacing?.bankAccountId ?? "");
  const [chequeNumber, setChequeNumber] = useState("");
  const [payeeKind, setPayeeKind] = useState<PayeeKind>(replacing?.payeeKind ?? "supplier");
  const [vendorId, setVendorId] = useState(replacing?.vendorId ?? "");
  const [expenseId, setExpenseId] = useState(replacing?.expenseId ?? "");
  const [amount, setAmount] = useState(replacing ? String(replacing.amount) : "");
  const [issueDate, setIssueDate] = useState(today);
  const [chequeDate, setChequeDate] = useState(today);
  const [memo, setMemo] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    getChequeFormData()
      .then((d) => {
        if (!live) return;
        setData(d);
        setBankAccountId((cur) => cur || d.banks[0]?.id || "");
        if (!replacing) setChequeNumber(d.firstNumber);
      })
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Each bank account has its own cheque book, so the suggested number follows the account.
  useEffect(() => {
    if (!bankAccountId || !data) return;
    let live = true;
    getNextChequeNumber(bankAccountId).then((n) => live && setChequeNumber(n)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [bankAccountId, data]);

  const amountNum = Number(amount);
  useEffect(() => {
    if (payeeKind !== "supplier" || !vendorId) return;
    let live = true;
    const t = setTimeout(() => {
      getSupplierPreview(vendorId, Number.isFinite(amountNum) ? amountNum : 0)
        .then((p) => live && setPreview(p))
        .catch(() => live && setPreview(null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [payeeKind, vendorId, amountNum]);
  const shownPreview = payeeKind === "supplier" && vendorId ? preview : null;

  const expense = data?.expenses.find((e) => e.id === expenseId) ?? null;

  // The forecast with this cheque in it, asked for a moment after the payee, amount or date stops changing (it is a full forecast, so not on every key).
  const payeeRef = payeeKind === "supplier" ? vendorId : expenseId;
  const outlookKey = payeeRef && amountNum > 0 && chequeDate ? `${payeeKind}|${payeeRef}|${amountNum}|${chequeDate}` : "";
  useEffect(() => {
    if (!outlookKey) return;
    let live = true;
    const t = setTimeout(() => {
      getFundingOutlook({ payeeKind, vendorId: payeeKind === "supplier" ? vendorId : null, expenseId: payeeKind === "expense" ? expenseId : null, amount: amountNum, chequeDate })
        .then((o) => live && setOutlook({ key: outlookKey, data: o }))
        .catch(() => undefined);
    }, 700);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlookKey]);

  // Cash on the day, from the forecast that already includes this cheque. Moving the cheque to another day only shifts that one amount.
  const funding = useMemo(() => {
    if (!outlook || outlook.key !== outlookKey) return null;
    const { openingCash, days, reserve: res } = outlook.data;
    const day = chequeDate < today ? today : chequeDate;
    const after = days.find((d) => d.date === day)?.balance ?? null;
    if (after === null) return { within: false as const };
    const position = positionOf(days, res);
    const without: ForecastDay[] = rollForward(openingCash, days, [{ date: day, amount: amountNum }]);
    const draft: EventDraft = { estimate: amountNum, high: null, plannedDate: day, pattern: "full", advancePct: null, balanceDays: null, instalments: null, intervalDays: null, creditDays: null, salesEffect: "none", salesEffectMonthly: null, salesEffectDays: null };
    const safest = safestDate(openingCash, without, [], draft, { earliest: day, latest: addDays(day, 30) }, res);
    return { within: true as const, day, after, position, safest };
  }, [outlook, outlookKey, chequeDate, today, amountNum]);

  function save() {
    setError(null);
    const input: ChequeInput = { bankAccountId, chequeNumber, payeeKind, vendorId: payeeKind === "supplier" ? vendorId || null : null, expenseId: payeeKind === "expense" ? expenseId || null : null, amount: amountNum, issueDate, chequeDate, memo: memo || null, replacesId: replacing?.id ?? null };
    start(async () => {
      const r = await issueChequeAction(input);
      if (r.ok) onSaved();
      else setError(r.error);
    });
  }

  const reserve = outlook?.data.reserve ?? 0;
  const postDated = chequeDate > today;

  return (
    <Modal
      size="xl"
      title={replacing ? `Re-issue cheque ${replacing.chequeNumber}` : "Issue a cheque"}
      description="This writes the cheque into the register. Nothing is posted to your books until the bank pays it."
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
      ) : data.banks.length === 0 ? (
        <p className="text-[13px] text-ink">There is no bank account to draw cheques on. Add a bank account in the Chart of Accounts first.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Cheque for">
                <Select value={payeeKind} onChange={(e) => setPayeeKind(e.target.value as PayeeKind)} disabled={Boolean(replacing)}>
                  <option value="supplier">A supplier (settles their bills)</option>
                  <option value="expense">An expense</option>
                </Select>
              </Field>
              {payeeKind === "supplier" ? (
                <Field label="Supplier" required>
                  <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)} disabled={Boolean(replacing)}>
                    <option value="">Select supplier</option>
                    {data.vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Field label="Expense" required>
                  <Select
                    value={expenseId}
                    onChange={(e) => {
                      setExpenseId(e.target.value);
                      const open = data.expenses.find((x) => x.id === e.target.value)?.open;
                      if (open) setAmount(String(open));
                    }}
                    disabled={Boolean(replacing)}
                  >
                    <option value="">Select expense</option>
                    {data.expenses.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.number} · {x.label} · {money(x.open)} open
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Drawn on" required>
                <Select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                  {data.banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Cheque number" required hint="The next number in this bank's cheque book.">
                <Input value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} className="font-mono" />
              </Field>
              <Field label="Issued on">
                <DatePicker value={issueDate} onChange={setIssueDate} max={today} className={`${controlClass} w-full`} />
              </Field>
              <Field label="Date on the cheque" required hint={postDated ? "Post-dated: it cannot be presented before this day." : "Dated today or earlier: it can be presented now."}>
                <DatePicker value={chequeDate} onChange={setChequeDate} min={issueDate} className={`${controlClass} w-full`} />
              </Field>
              <Field label="Amount" required hint={expense ? `Up to ${money(expense.open)}, what is still open on this expense.` : undefined}>
                <AmountInput type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-right" />
              </Field>
              <Field label="Note">
                <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional" />
              </Field>
            </div>
            {error && <p className="text-[13px] text-[var(--danger-text)]">{error}</p>}
          </div>

          <aside className="h-fit space-y-4 rounded-lg border border-line bg-surface-2 p-3 text-[13px]" aria-live="polite">
            {payeeKind === "supplier" && (
              <div>
                <p className="mb-1.5 font-semibold text-ink">What it would settle</p>
                {!vendorId ? (
                  <p className="text-xs text-ink-2">Choose a supplier to see their open bills.</p>
                ) : !shownPreview ? (
                  <p className="text-xs text-ink-2">Looking up their bills…</p>
                ) : shownPreview.owed <= 0 ? (
                  <p className="text-xs text-ink-2">This supplier has no open bills. The cheque would be kept as an advance with them.</p>
                ) : (
                  <>
                    <p className="text-xs text-ink-2">They are owed {money(shownPreview.owed)} on open bills.</p>
                    {shownPreview.settles.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-xs">
                        {shownPreview.settles.map((s) => (
                          <li key={s.number} className="flex justify-between gap-2">
                            <span className="text-ink-2">
                              {s.number} {s.full ? "paid in full" : "part-paid"}
                            </span>
                            <span className="tnum text-ink">{money(s.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {shownPreview.advance > 0 && <p className="mt-1 text-xs text-ink-2">{money(shownPreview.advance)} more than they are owed stays with them as an advance.</p>}
                  </>
                )}
              </div>
            )}

            <div>
              <p className="mb-1.5 flex items-center gap-2 font-semibold text-ink">
                Cash on the day <StatusPill tone="pending">Forecast</StatusPill>
              </p>
              {!outlookKey ? (
                <p className="text-xs text-ink-2">Choose who the cheque is for and enter the amount to see what it does to your cash.</p>
              ) : !funding ? (
                <p className="text-xs text-ink-2">Working out your cash on that day…</p>
              ) : !funding.within ? (
                <p className="text-xs text-ink-2">That date is more than 180 days away, beyond the forecast.</p>
              ) : (
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="text-ink-2">
                      Expected on <D value={funding.day} style="short" />, after this cheque
                    </span>
                    <span className={`tnum font-medium ${funding.after < 0 ? "text-[var(--danger-text)]" : "text-ink"}`}>{money(funding.after)}</span>
                  </div>
                  {reserve > 0 && (
                    <div className="flex justify-between gap-2">
                      <span className="text-ink-2">Your reserve</span>
                      <span className="tnum text-ink">{money(reserve)}</span>
                    </div>
                  )}
                  <p className="border-t border-line pt-2 text-[13px] text-ink">
                    {funding.position.shortfallDate ? (
                      <>
                        <StatusPill tone="critical">May not be covered</StatusPill> Cash is expected to run out from <D value={funding.position.shortfallDate} style="short" />. A cheque that bounces can have legal consequences.
                      </>
                    ) : funding.position.breachDate ? (
                      <>
                        <StatusPill tone="action">Below reserve</StatusPill> It is covered, but cash falls below your reserve from <D value={funding.position.breachDate} style="short" />.
                      </>
                    ) : (
                      <>
                        <StatusPill tone="success">Covered</StatusPill> Cash stays above your reserve.
                      </>
                    )}
                  </p>
                  {funding.safest && funding.safest.date !== funding.day && funding.safest.position.lowest.balance > funding.position.lowest.balance + 0.5 && (
                    <p className="text-ink-2">
                      Safer: date it <D value={funding.safest.date} style="short" />, when the lowest cash is {money(funding.safest.position.lowest.balance)}.{" "}
                      <button type="button" className="text-accent-text hover:underline" onClick={() => setChequeDate(funding.safest!.date)}>
                        Use that date
                      </button>
                    </p>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </Modal>
  );
}
