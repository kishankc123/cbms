"use client";

import { useMemo, useState } from "react";
import { D } from "@/components/calendar/date-text";
import { StatusPill } from "@/components/ui/status-pill";
import { useProblem } from "@/components/problem-dialog";
import { confirmMatch, createBankTransaction, type StatementLineRow, type UnmatchedLedgerRow } from "./actions";
import { AccountPicker, postableAccounts, type AccountOption } from "./account-picker";

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;
const dayGap = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;
const field = "w-full rounded border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-sm text-[var(--text-primary)]";

type Tab = "find" | "create";
type Row = { accountId: string; amount: string };

/**
 * Everything for one bank line that has no confirmed match, in one panel.
 *
 * Find & match: pick the book entries it belongs to (one deposit can cover several invoices) and see at once whether they add up
 * to the bank amount. Only entries already posted to this bank's own ledger account are offered, the closest first. If they fall
 * short or run over (a bank fee, say), the difference can be recorded there and then.
 *
 * Create transaction: nothing in the books yet, so record it: one account, or several (a split) that add up to the bank amount.
 */
export function LinePanel({
  bankAccountId,
  bankLedgerId,
  line,
  ledger,
  accounts,
  locked,
  onClose,
  onDone,
  onRecordPayment,
}: {
  bankAccountId: string;
  bankLedgerId: string | null;
  line: StatementLineRow;
  ledger: UnmatchedLedgerRow[];
  accounts: AccountOption[];
  locked: boolean;
  onClose: () => void;
  onDone: () => void;
  onRecordPayment: () => void;
}) {
  const [tab, setTab] = useState<Tab>("find");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [differenceAccount, setDifferenceAccount] = useState("");
  const [rows, setRows] = useState<Row[]>([{ accountId: "", amount: Math.abs(line.amount).toFixed(2) }]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const { report, dialog } = useProblem();
  const choices = useMemo(() => postableAccounts(accounts, bankLedgerId), [accounts, bankLedgerId]);
  const moneyIn = line.amount >= 0;

  // Closest first: an entry for the same amount near the same date is the likely one.
  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ledger
      .filter((l) => !q || `${l.memo ?? ""} ${l.description ?? ""} ${l.referenceNumber ?? ""} ${l.signedAmount}`.toLowerCase().includes(q))
      .sort((a, b) => Math.abs(a.signedAmount - line.amount) - Math.abs(b.signedAmount - line.amount) || dayGap(a.entryDate, line.transactionDate) - dayGap(b.entryDate, line.transactionDate));
  }, [ledger, line, search]);

  const total = round2(ledger.filter((l) => picked.has(l.journalLineId)).reduce((s, l) => s + l.signedAmount, 0));
  const gap = round2(line.amount - total);
  const matching = picked.size > 0 && Math.abs(gap) < 0.005;

  const splitTotal = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const splitMatching = Math.abs(splitTotal - Math.abs(line.amount)) < 0.005 && rows.every((r) => r.accountId && Number(r.amount) > 0);

  async function run(job: () => Promise<unknown>, failure: string) {
    setBusy(true);
    try {
      await job();
      onDone();
      onClose();
    } catch (e) {
      report(e instanceof Error ? e.message : failure, null);
    } finally {
      setBusy(false);
    }
  }

  const match = () => run(() => confirmMatch({ bankAccountId, statementLineIds: [line.id], journalLineIds: [...picked], matchType: "manual" }), "This couldn't be matched. Check that the entries add up to the bank amount.");
  const recordDifference = () =>
    run(
      () => createBankTransaction({ statementLineId: line.id, bankAccountId, comment: comment || "Difference on bank line", alongsideJournalLineIds: [...picked], splits: [{ offsetAccountId: differenceAccount, amount: Math.abs(gap) }] }),
      "The difference couldn't be recorded."
    );
  const create = () =>
    run(() => createBankTransaction({ statementLineId: line.id, bankAccountId, comment, splits: rows.map((r) => ({ offsetAccountId: r.accountId, amount: Number(r.amount) })) }), "The transaction couldn't be created.");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Find or create</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              <D value={line.transactionDate} /> · {line.description || "—"} · <span className={moneyIn ? "text-green-700" : "text-red-600"}>{fmt(line.amount)}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex gap-1 border-b border-[var(--card-border)]">
          {([["find", "Find & match"], ["create", "Create transaction"]] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)} className={`px-4 py-2 text-sm ${tab === key ? "border-b-2 border-[var(--color-primary)] font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === "find" ? (
          <>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your books by description, reference or amount" className={field} />
            <div className="max-h-64 overflow-y-auto rounded border border-[var(--card-border)]">
              {sorted.length === 0 ? (
                <p className="p-6 text-center text-sm text-[var(--text-secondary)]">{ledger.length === 0 ? "Everything in your books for this account is already matched." : "Nothing matches that search."}</p>
              ) : (
                <ul className="divide-y divide-[var(--card-border)]">
                  {sorted.map((l) => (
                    <li key={l.journalLineId}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-[var(--surface-muted-bg)]">
                        <input
                          type="checkbox"
                          checked={picked.has(l.journalLineId)}
                          onChange={() =>
                            setPicked((prev) => {
                              const next = new Set(prev);
                              if (next.has(l.journalLineId)) next.delete(l.journalLineId);
                              else next.add(l.journalLineId);
                              return next;
                            })
                          }
                        />
                        <span className="w-24 shrink-0 text-[var(--text-secondary)]">
                          <D value={l.entryDate} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{l.memo || l.description || l.referenceNumber || "—"}</span>
                        <span className="tabular-nums text-[var(--text-primary)]">{fmt(l.signedAmount)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-[var(--text-secondary)]">
                Selected <span className="tabular-nums text-[var(--text-primary)]">{fmt(total)}</span> of <span className="tabular-nums text-[var(--text-primary)]">{fmt(line.amount)}</span>
              </span>
              {picked.size > 0 && (matching ? <StatusPill tone="success">Matching</StatusPill> : <StatusPill tone="critical">Not matching: {fmt(gap)} to go</StatusPill>)}
            </div>

            {picked.size > 0 && !matching && (
              <div className="space-y-2 rounded border border-[var(--card-border)] p-3">
                <p className="text-sm text-[var(--text-primary)]">
                  {gap > 0 ? `The bank has ${fmt(gap)} more than these entries.` : `The bank has ${fmt(-gap)} less than these entries.`} If that is a bank fee, interest or something similar, record it here and everything is matched together.
                </p>
                <AccountPicker options={choices} value={differenceAccount} onChange={setDifferenceAccount} />
                <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional), for example Bank fee" className={field} />
                <button type="button" disabled={busy || locked || !differenceAccount} onClick={recordDifference} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-40">
                  Record the {fmt(Math.abs(gap))} and match
                </button>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <button type="button" onClick={() => setTab("create")} className="text-sm text-[var(--color-primary)] hover:underline">
                Nothing here? Create a transaction
              </button>
              <button type="button" disabled={busy || locked || !matching} onClick={match} className="rounded bg-[var(--color-primary)] px-5 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-40">
                Match
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--text-secondary)]">{moneyIn ? "Where did this money come from?" : "What was this paid for?"} Use more than one account to split it.</p>
            <div className="space-y-3">
              {rows.map((r, i) => (
                <div key={i} className="space-y-2 rounded border border-[var(--card-border)] p-3">
                  <AccountPicker options={choices} value={r.accountId} onChange={(accountId) => setRows(rows.map((x, k) => (k === i ? { ...x, accountId } : x)))} />
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                      Amount
                      <input value={r.amount} inputMode="decimal" onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))} className="w-32 rounded border border-[var(--card-border)] bg-[var(--card-bg)] px-2 py-1 text-right text-sm tabular-nums text-[var(--text-primary)]" />
                    </label>
                    {rows.length > 1 && (
                      <button type="button" onClick={() => setRows(rows.filter((_, k) => k !== i))} className="text-sm text-red-600 hover:underline">
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setRows([...rows, { accountId: "", amount: Math.max(round2(Math.abs(line.amount) - splitTotal), 0).toFixed(2) }])}
                className="text-sm text-[var(--color-primary)] hover:underline"
              >
                + Add another account (split)
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-[var(--text-secondary)]">
                Total <span className="tabular-nums text-[var(--text-primary)]">{fmt(splitTotal)}</span> of <span className="tabular-nums text-[var(--text-primary)]">{fmt(Math.abs(line.amount))}</span>
              </span>
              {splitMatching ? <StatusPill tone="success">Matching</StatusPill> : <StatusPill tone="critical">Not matching</StatusPill>}
            </div>

            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Add a comment (optional)" className={field} />

            <div className="flex items-center justify-between gap-3">
              <button type="button" onClick={onRecordPayment} className="text-left text-sm text-[var(--color-primary)] hover:underline">
                Money from a customer or to a supplier? Record a {moneyIn ? "receipt" : "payment"} instead
              </button>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onClose} className="rounded px-4 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-muted-bg)]">
                  Cancel
                </button>
                <button type="button" disabled={busy || locked || !splitMatching} onClick={create} className="rounded bg-[var(--color-primary)] px-5 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-40">
                  Save
                </button>
              </div>
            </div>
          </>
        )}
        {locked && <p className="text-xs text-amber-700">This date falls inside a period that is already reconciled. Reopen it to change anything here.</p>}
      </div>
      {dialog}
    </div>
  );
}
