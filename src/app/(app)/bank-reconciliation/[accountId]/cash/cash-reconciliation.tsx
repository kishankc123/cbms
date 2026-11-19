"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useProblem } from "@/components/problem-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { DatePicker } from "@/components/calendar/date-picker";
import { D } from "@/components/calendar/date-text";
import { AmountInput } from "@/components/ui/amount-input";
import { controlClass } from "@/components/ui/field";
import { ExpenseFormModal } from "../../../expenses/expense-form-modal";
import { CountForm } from "../../../reports/daybook/cash-count";
import type { CashWorkspace, HistoryRow } from "@/lib/ledger/cash-reconcile";
import { settle } from "@/lib/ledger/cash-reconcile-rules";
import { explainExcessAction, getCashWorkspaceAction, reopenCashReconciliationAction, signOffCashAction } from "../../cash-actions";

const th = "border-b border-line bg-app px-2.5 py-1.5 text-left text-xs font-medium text-ink-2";
const td = "border-b border-line px-2.5 py-1.5 align-top";
const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n: number) => (n < 0 ? `(${money.format(Math.abs(n))})` : money.format(n));

type ExpenseForm = { vendors: { id: string; name: string }[]; categoryAccounts: React.ComponentProps<typeof ExpenseFormModal>["categoryAccounts"]; cashBankAccounts: React.ComponentProps<typeof ExpenseFormModal>["cashBankAccounts"]; vatRate: number };

export function CashReconciliation({
  bankAccountId,
  accountName,
  initial,
  today,
  history,
  canEdit,
  canReopen,
  expenseForm,
  incomeAccounts,
  shortExcessName,
}: {
  bankAccountId: string;
  accountName: string;
  initial: CashWorkspace;
  today: string;
  history: HistoryRow[];
  canEdit: boolean;
  canReopen: boolean;
  expenseForm: ExpenseForm | null;
  incomeAccounts: { id: string; label: string }[];
  shortExcessName: string;
}) {
  const router = useRouter();
  const ask = useConfirm();
  const toast = useToast();
  const { report, dialog } = useProblem();
  const [ws, setWs] = useState(initial);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [useCount, setUseCount] = useState(Boolean(initial.count));
  const [adjust, setAdjust] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [counting, setCounting] = useState(false);
  const [explainShort, setExplainShort] = useState<HistoryRow | null>(null);
  const [explainOver, setExplainOver] = useState<HistoryRow | null>(null);
  const [reopening, setReopening] = useState<HistoryRow | null>(null);

  const totals = useMemo(() => {
    let cashIn = 0;
    let cashOut = 0;
    for (const l of ws.lines) if (ticked.has(l.id)) {
      cashIn += l.cashIn;
      cashOut += l.cashOut;
    }
    return { cashIn: Math.round(cashIn * 100) / 100, cashOut: Math.round(cashOut * 100) / 100 };
  }, [ws.lines, ticked]);
  const counted = useCount && ws.count ? ws.count.total : null;
  const s = settle({ opening: ws.opening, cashIn: totals.cashIn, cashOut: totals.cashOut, counted, adjust: false });
  const hasDifference = s.difference !== null && Math.abs(s.difference) >= 0.005;
  const closing = adjust && hasDifference && counted !== null ? counted : s.booksBefore;
  const untickedCount = ws.lines.length - ticked.size;

  async function load(asOf: string) {
    setBusy(true);
    try {
      const next = await getCashWorkspaceAction({ bankAccountId, asOf });
      setWs(next);
      setTicked(new Set());
      setUseCount(Boolean(next.count));
      setAdjust(false);
      return next;
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not load the entries", null);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) =>
    setTicked((t) => {
      const n = new Set(t);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allTicked = ws.lines.length > 0 && ticked.size === ws.lines.length;

  async function reconcile() {
    if (untickedCount > 0 && ws.lines.length > 0 && ticked.size > 0) {
      if (!(await ask(`${untickedCount} ${untickedCount === 1 ? "entry is" : "entries are"} not ticked. ${untickedCount === 1 ? "It stays" : "They stay"} open for the next reconciliation.`, { confirmLabel: "Reconcile" }))) return;
    }
    if (hasDifference && !adjust) {
      const word = (s.difference ?? 0) < 0 ? "short" : "over";
      if (!(await ask(`The count is ${money.format(Math.abs(s.difference ?? 0))} ${word} against the books. Reconcile without adjusting it? Your books will keep saying ${money.format(s.booksBefore)}.`, { confirmLabel: "Reconcile anyway" }))) return;
    }
    if (adjust && hasDifference) {
      if (!(await ask(`Post the ${money.format(Math.abs(s.difference ?? 0))} ${(s.difference ?? 0) < 0 ? "short" : "excess"} to ${shortExcessName}, dated ${ws.asOf}? This changes your books so they agree with the count.`, { confirmLabel: "Post and reconcile" }))) return;
    }
    setBusy(true);
    try {
      await signOffCashAction({ bankAccountId, asOf: ws.asOf, lineIds: [...ticked], useCount: useCount && Boolean(ws.count), adjust: adjust && hasDifference, note });
      toast.success(`Reconciled up to ${ws.asOf}. Closing balance ${money.format(closing)}.`);
      setNote("");
      await load(ws.asOf);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not reconcile", null);
    } finally {
      setBusy(false);
    }
  }

  const dateOnly = ws.last && ws.last.asOf === ws.asOf;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Reconcile up to">
          <DatePicker id="cash-asof" value={ws.asOf} max={today} min={ws.last?.asOf} onChange={(v) => v && v !== ws.asOf && void load(v)} className={`${controlClass} w-44`} />
        </Field>
        <Button onClick={() => setTicked(allTicked ? new Set() : new Set(ws.lines.map((l) => l.id)))} disabled={ws.lines.length === 0 || !canEdit}>
          {allTicked ? "Untick all" : "Select all up to this date"}
        </Button>
        {ws.last && (
          <p className="pb-1.5 text-xs text-ink-2">
            Last reconciled up to <D value={ws.last.asOf} />, closing {money.format(ws.last.closing)}
            {ws.last.kind === "counted" ? ", counted" : ", confirmed, not counted"}.
          </p>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-line bg-surface p-2">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={`${th} w-8`}>
                    <input type="checkbox" aria-label="Tick all" checked={allTicked} disabled={ws.lines.length === 0 || !canEdit} onChange={() => setTicked(allTicked ? new Set() : new Set(ws.lines.map((l) => l.id)))} />
                  </th>
                  <th className={th}>Date</th>
                  <th className={th}>Reference</th>
                  <th className={th}>Particulars</th>
                  <th className={`${th} text-right`}>In</th>
                  <th className={`${th} text-right`}>Out</th>
                </tr>
              </thead>
              <tbody>
                {ws.lines.map((l) => (
                  <tr key={l.id} onClick={canEdit ? () => toggle(l.id) : undefined} className={`transition-colors hover:bg-hover ${canEdit ? "cursor-pointer select-none" : ""} ${ticked.has(l.id) ? "bg-hover" : ""}`}>
                    <td className={td}>
                      <input type="checkbox" aria-label={`Tick ${l.label}`} checked={ticked.has(l.id)} disabled={!canEdit} onClick={(e) => e.stopPropagation()} onChange={() => toggle(l.id)} />
                    </td>
                    <td className={td}>
                      <D value={l.date} />
                    </td>
                    <td className={td}>{l.reference}</td>
                    <td className={`${td} text-ink-2`}>{l.label}</td>
                    <td className={`${td} text-right tabular-nums`}>{l.cashIn ? money.format(l.cashIn) : ""}</td>
                    <td className={`${td} text-right tabular-nums`}>{l.cashOut ? money.format(l.cashOut) : ""}</td>
                  </tr>
                ))}
                {adjust && hasDifference && (
                  <tr className="bg-hover">
                    <td className={td}>
                      <input type="checkbox" checked disabled aria-label="Adjustment, posted when you reconcile" />
                    </td>
                    <td className={td}>
                      <D value={ws.asOf} />
                    </td>
                    <td className={td}>{(s.difference ?? 0) < 0 ? "CASH-SHORT" : "CASH-EXCESS"}</td>
                    <td className={`${td} text-ink-2`}>{(s.difference ?? 0) < 0 ? "Cash short found at count" : "Cash excess found at count"} (posted when you reconcile)</td>
                    <td className={`${td} text-right tabular-nums`}>{(s.difference ?? 0) > 0 ? money.format(s.difference ?? 0) : ""}</td>
                    <td className={`${td} text-right tabular-nums`}>{(s.difference ?? 0) < 0 ? money.format(Math.abs(s.difference ?? 0)) : ""}</td>
                  </tr>
                )}
                {ws.lines.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-ink-3">
                      {dateOnly || ws.last ? "Nothing new to reconcile up to this date." : "No cash entries up to this date."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="space-y-3">
          <section className="rounded-lg border border-line bg-surface p-3.5 text-[13px]">
            <Row label="Opening (last reconciled)" value={money.format(ws.opening)} />
            <Row label="+ Ticked cash in" value={money.format(totals.cashIn)} />
            <Row label="− Ticked cash out" value={money.format(totals.cashOut)} />
            {adjust && hasDifference && <Row label={(s.difference ?? 0) < 0 ? "Short adjusted" : "Excess adjusted"} value={fmt(s.difference ?? 0)} />}
            <div className="mt-1 flex justify-between border-t border-line pt-1.5 font-medium text-ink">
              <span>Closing balance</span>
              <span className="tabular-nums">{money.format(closing)}</span>
            </div>
            {untickedCount > 0 && <p className="mt-1.5 text-xs text-ink-2">{untickedCount === 1 ? "1 entry is not ticked and stays open." : `${untickedCount} entries are not ticked and stay open.`}</p>}
            <p className="mt-1 text-xs text-ink-3">Your ledger holds {money.format(ws.ledgerBalance)} up to this date.</p>
          </section>

          <section className="rounded-lg border border-line bg-surface p-3.5 text-[13px]">
            <p className="mb-1 font-medium text-ink">
              Cash counted <span className="font-normal text-ink-2">(optional)</span>
            </p>
            {ws.count ? (
              <>
                <Row label="Counted" value={money.format(ws.count.total)} />
                <p className="mt-1 text-xs text-ink-2">
                  From the Daybook count{ws.count.counter ? ` by ${ws.count.counter}` : ""}, {ws.count.byNotes ? "by notes and coins" : "total only"}. Nothing is entered again.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setUseCount((u) => !u)}>
                    {useCount ? "Don't use this count" : "Use this count"}
                  </Button>
                  {canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => setCounting(true)}>
                      Change the count
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-ink-2">No count of this account on this date.{ws.otherCountDate ? <> It was last counted on <D value={ws.otherCountDate} />.</> : null}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {canEdit && (
                    <Button size="sm" onClick={() => setCounting(true)}>
                      Count cash now
                    </Button>
                  )}
                  {ws.otherCountDate && ws.otherCountDate !== ws.asOf && ws.otherCountDate <= today && (!ws.last || ws.otherCountDate >= ws.last.asOf) && (
                    <Button size="sm" variant="ghost" onClick={() => void load(ws.otherCountDate as string)}>
                      Reconcile up to that date
                    </Button>
                  )}
                </div>
              </>
            )}
          </section>

          <section className="rounded-lg bg-surface-2 p-3.5 text-[13px]">
            {counted === null ? (
              <>
                <StatusPill tone="pending">Not counted</StatusPill>
                <p className="mt-1.5 text-xs text-ink-2">You can still mark the closing balance as reconciled. It is recorded as &ldquo;Confirmed, not counted&rdquo;.</p>
              </>
            ) : !hasDifference ? (
              <>
                <StatusPill tone="success">Counted and agrees</StatusPill>
                <p className="mt-1.5 text-xs text-ink-2">The books and the cash counted are the same.</p>
              </>
            ) : (
              <>
                <StatusPill tone="critical">
                  {(s.difference ?? 0) < 0 ? "Short" : "Excess"} {money.format(Math.abs(s.difference ?? 0))}
                </StatusPill>
                <p className="mt-1.5 text-xs text-ink-2">
                  Counted {money.format(counted)}; the books say {money.format(s.booksBefore)}. Adjust it so the books agree with the count, or reconcile with a note.
                </p>
                {canEdit && (
                  <Button size="sm" className="mt-2" onClick={() => setAdjust((a) => !a)}>
                    {adjust ? "Don't adjust" : `Adjust ${(s.difference ?? 0) < 0 ? "short" : "excess"} ${money.format(Math.abs(s.difference ?? 0))}`}
                  </Button>
                )}
              </>
            )}
            {canEdit && (
              <div className="mt-2">
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={hasDifference ? "Note about the difference (optional)" : "Note (optional)"} maxLength={300} aria-label="Note" />
              </div>
            )}
          </section>

          {canEdit && (
            <Button variant="primary" className="w-full" loading={busy} onClick={reconcile}>
              {counted === null ? "Mark closing as reconciled" : "Mark as reconciled"}
            </Button>
          )}
          <p className="text-xs text-ink-3">
            Has a statement from a wallet?{" "}
            <Link href={`/bank-reconciliation/${bankAccountId}`} className="text-accent hover:underline">
              Match a statement instead
            </Link>
            .
          </p>
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">Past reconciliations of {accountName}</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={th}>Up to</th>
                <th className={`${th} text-right`}>Opening</th>
                <th className={`${th} text-right`}>Closing</th>
                <th className={th}>Proof</th>
                <th className={th}>Difference</th>
                <th className={th}>By</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className={`transition-colors hover:bg-hover ${h.status !== "reconciled" ? "text-ink-3" : ""}`}>
                  <td className={td}>
                    <D value={h.asOf} />
                    {h.status !== "reconciled" && <p className="text-xs">Reopened{h.reopenReason ? `: ${h.reopenReason}` : ""}</p>}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{money.format(h.opening)}</td>
                  <td className={`${td} text-right tabular-nums`}>{money.format(h.closing)}</td>
                  <td className={td}>{h.kind === "counted" ? `Counted ${money.format(h.counted ?? 0)}` : "Confirmed, not counted"}</td>
                  <td className={td}>
                    {h.difference === null || Math.abs(h.difference) < 0.005 ? (
                      <span className="text-ink-2">{h.difference === null ? "" : "None"}</span>
                    ) : h.adjustment === 0 ? (
                      <span className="text-[var(--warning-text)]">
                        {h.difference < 0 ? "Short" : "Excess"} {money.format(Math.abs(h.difference))}, not adjusted
                      </span>
                    ) : (
                      <>
                        <span>
                          {h.adjustment < 0 ? "Short" : "Excess"} {money.format(Math.abs(h.adjustment))}
                        </span>
                        <p className={`text-xs ${h.state === "explained" ? "text-[var(--success-text)]" : "text-[var(--warning-text)]"}`}>
                          {h.state === "explained" ? "Explained" : h.state === "partly" ? `${money.format(h.explained)} explained, ${money.format(h.remaining)} not` : "Not explained yet"}
                        </p>
                      </>
                    )}
                  </td>
                  <td className={`${td} text-ink-2`}>
                    {h.by}
                    <p className="text-xs">
                      <D value={h.at} />
                    </p>
                  </td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {canEdit && h.status === "reconciled" && h.adjustment < 0 && h.remaining > 0 && expenseForm && (
                      <button type="button" onClick={() => setExplainShort(h)} className="mr-3 text-xs text-accent hover:underline">
                        Explain
                      </button>
                    )}
                    {canEdit && h.status === "reconciled" && h.adjustment > 0 && h.remaining > 0 && (
                      <button type="button" onClick={() => setExplainOver(h)} className="mr-3 text-xs text-accent hover:underline">
                        Explain
                      </button>
                    )}
                    {canReopen && h.latest && (
                      <button type="button" onClick={() => setReopening(h)} className="text-xs text-accent hover:underline">
                        Reopen
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-3">
                    Nothing reconciled yet. Tick the entries you have checked and mark the closing balance as reconciled.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {counting && (
        <Modal title={`Count cash, ${accountName}`} description={`Counted on ${ws.asOf}. The same count appears in the Daybook.`} size="lg" onClose={() => setCounting(false)}>
          <CountForm
            day={ws.asOf}
            account={{
              id: ws.account.accountId,
              name: accountName,
              book: s.booksBefore,
              saved: ws.count ? { accountId: ws.account.accountId, notes: ws.count.notes, other: ws.count.other, counted: ws.count.total, book: ws.count.book, remark: ws.count.remark, updatedAt: ws.count.updatedAt } : null,
            }}
            canEdit={canEdit}
            showName={false}
            onSaved={async () => {
              setCounting(false);
              const next = await getCashWorkspaceAction({ bankAccountId, asOf: ws.asOf }).catch(() => null);
              if (next) {
                setWs((w) => ({ ...w, count: next.count }));
                setUseCount(Boolean(next.count));
              }
            }}
          />
        </Modal>
      )}

      {explainShort && expenseForm && (
        <ExpenseFormModal
          {...expenseForm}
          explain={{ reconId: explainShort.id, bankAccountId, amount: explainShort.remaining, accountName: shortExcessName }}
          onClose={() => {
            setExplainShort(null);
            router.refresh();
          }}
        />
      )}

      {explainOver && (
        <ExplainExcess
          row={explainOver}
          accounts={incomeAccounts}
          today={today}
          onClose={() => setExplainOver(null)}
          onDone={() => {
            setExplainOver(null);
            toast.success("Explained. The excess has moved to the income account.");
            router.refresh();
          }}
          bankAccountId={bankAccountId}
        />
      )}

      {reopening && (
        <ReopenDialog
          row={reopening}
          onClose={() => setReopening(null)}
          onDone={async () => {
            setReopening(null);
            toast.success("Reopened.");
            await load(ws.asOf);
            router.refresh();
          }}
          bankAccountId={bankAccountId}
        />
      )}
      {dialog}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-ink-2">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function ExplainExcess({ row, accounts, today, bankAccountId, onClose, onDone }: { row: HistoryRow; accounts: { id: string; label: string }[]; today: string; bankAccountId: string; onClose: () => void; onDone: () => void }) {
  const { report, dialog } = useProblem();
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState(String(row.remaining));
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!accountId) return report("Choose the income account the extra cash belongs to.", null);
    setBusy(true);
    try {
      await explainExcessAction({ reconId: row.id, bankAccountId, accountId, amount: parseFloat(amount) || 0, date, note });
      onDone();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not save", null);
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Explain the excess"
      description={`${money.format(row.remaining)} of the excess found up to ${row.asOf} is still unexplained. If it was money received and never recorded, move it to the income it belongs to. Your cash is not changed again.`}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Income account" required>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount explained">
            <AmountInput bare type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-8 w-full rounded-md border border-line-strong bg-surface px-2.5 text-right text-[13px]" />
          </Field>
          <Field label="Date found">
            <DatePicker id="explain-date" value={date} max={today} onChange={(v) => setDate(v)} className={`${controlClass} w-full`} />
          </Field>
        </div>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What the money was" maxLength={300} />
        </Field>
      </div>
      {dialog}
    </Modal>
  );
}

function ReopenDialog({ row, bankAccountId, onClose, onDone }: { row: HistoryRow; bankAccountId: string; onClose: () => void; onDone: () => void }) {
  const { report, dialog } = useProblem();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!reason.trim()) return report("Say why it is being reopened.", null);
    setBusy(true);
    try {
      await reopenCashReconciliationAction({ reconId: row.id, bankAccountId, reason });
      onDone();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not reopen", null);
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Reopen this reconciliation"
      description={`The entries ticked up to ${row.asOf} become open again. ${row.adjustment !== 0 ? "A short or excess that was posted stays in your books as an entry; void it from the ledger if it was wrong." : ""}`}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Reopen
          </Button>
        </>
      }
    >
      <Field label="Reason" required>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      </Field>
      {dialog}
    </Modal>
  );
}
