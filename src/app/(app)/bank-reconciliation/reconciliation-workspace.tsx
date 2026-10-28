"use client";

import { useEffect, useState } from "react";
import {
  getReconciliationWorkspace,
  getSuggestedMatchesForAccount,
  confirmMatch,
  confirmExactMatches,
  unmatch,
  markReconciled,
  previewReconciliation,
  reopenReconciliation,
  listReconciliationHistory,
  type MatchedEntry,
  type StatementLineRow,
  type UnmatchedLedgerRow,
} from "./actions";
import type { MatchCandidate } from "@/lib/banking/matching";
import { UploadStatementModal } from "./upload-statement-modal";
import { CreateBankTransactionModal } from "./create-bank-transaction-modal";
import { ClassifyLedgerModal } from "./classify-ledger-modal";
import { FindMatchPanel } from "./find-match-panel";
import { DifferencePanel } from "./difference-panel";

import { todayIso } from "@/lib/calendar";
import { DatePicker } from "@/components/calendar/date-picker";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { useProblem } from "@/components/problem-dialog";
import { D, DT } from "@/components/calendar/date-text";
type BankAccountOption = { id: string; label: string };
type OffsetAccount = { id: string; code: string; name: string; category: string };
type Workspace = Awaited<ReturnType<typeof getReconciliationWorkspace>>;
type Reconciliation = Awaited<ReturnType<typeof listReconciliationHistory>>[number];

// What each bank line is waiting for: nothing (matched), your OK (an exact or a likely match found), or a transaction to be found or created.
type State = "matched" | "exact" | "likely" | "none";
type Row = { line: StatementLineRow; state: State; entries: MatchedEntry[]; suggestion: MatchCandidate | null };
type Filter = "todo" | "matched" | "all";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "matched", label: "Matched" },
  { key: "all", label: "All" },
];

// Green: an exact match (or already matched). Amber: a likely match that needs your OK. Red: nothing found.
const TONE: Record<State, string> = {
  matched: "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-text)]",
  exact: "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-text)]",
  likely: "border-[var(--status-action-border)] bg-[var(--status-action-bg)] text-[var(--status-action-text)]",
  none: "border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] text-[var(--status-critical-text)]",
};

const OLD_AFTER_DAYS = 15;
const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

function differenceText(difference: number, hasStatement: boolean) {
  if (!hasStatement) return "Upload a statement to compare it with your books.";
  if (Math.abs(difference) < 0.005) return "The bank balance matches your books.";
  return difference > 0 ? "The bank balance is higher than your books." : "The bank balance is lower than your books.";
}

export function ReconciliationWorkspace({ bankAccounts, offsetAccounts }: { bankAccounts: BankAccountOption[]; offsetAccounts: OffsetAccount[] }) {
  const ask = useConfirm();
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? "");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, MatchCandidate>>({});
  const [history, setHistory] = useState<Reconciliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("todo");
  const [showUpload, setShowUpload] = useState(false);
  const [findingFor, setFindingFor] = useState<StatementLineRow | null>(null);
  const [creatingForLine, setCreatingForLine] = useState<StatementLineRow | null>(null);
  const [classifyingLine, setClassifyingLine] = useState<UnmatchedLedgerRow | null>(null);
  const [showDifference, setShowDifference] = useState(false);
  // Problems are shown in a dialog that says why.
  const { report, dialog } = useProblem();
  const [reconcileEnd, setReconcileEnd] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [showReopen, setShowReopen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  const today = todayIso();

  async function load() {
    if (!bankAccountId) return;
    setLoading(true);
    try {
      const [ws, sugg, hist] = await Promise.all([getReconciliationWorkspace(bankAccountId), getSuggestedMatchesForAccount(bankAccountId), listReconciliationHistory(bankAccountId)]);
      setWorkspace(ws);
      setSuggestions(sugg);
      setHistory(hist);
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to load", null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankAccountId]);

  // Runs one change, then reloads the list; a refusal is shown as a plain message.
  async function run(job: () => Promise<unknown>, failure: string) {
    setBusy(true);
    try {
      await job();
      await load();
    } catch (e) {
      report(e instanceof Error ? e.message : failure, null);
    } finally {
      setBusy(false);
    }
  }

  const confirmSuggested = (line: StatementLineRow, c: MatchCandidate) =>
    run(() => confirmMatch({ bankAccountId, statementLineIds: [line.id], journalLineIds: [c.journalLineId], matchType: c.tier, confidence: c.score }), "Failed to confirm the match");

  async function unmatchLine(line: StatementLineRow) {
    if (!line.matchId) return;
    if (!(await ask("Undo this match? The bank line and the book entry go back to the list.", { confirmLabel: "Undo match", danger: true }))) return;
    await run(() => unmatch(line.matchId!), "Failed to undo the match");
  }

  async function okAll(count: number) {
    if (!(await ask(`Confirm all ${count} exact match${count === 1 ? "" : "es"}? Each has the same amount and a matching entry in your books.`, { confirmLabel: "OK all" }))) return;
    setBusy(true);
    try {
      const r = await confirmExactMatches(bankAccountId);
      await load();
      if (r.skipped > 0) report(`${r.confirmed} confirmed. ${r.skipped} couldn't be confirmed (for example, they fall in a period that is already reconciled), so they are still in the list.`, null);
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to confirm the matches", null);
    } finally {
      setBusy(false);
    }
  }

  // Shows what would be recorded (or why it can't be yet) before anything is saved.
  async function handleMarkReconciled() {
    setBusy(true);
    try {
      const p = await previewReconciliation({ bankAccountId, periodEnd: reconcileEnd });
      if (p.blockers.length > 0) {
        report("This can't be marked reconciled yet: " + p.blockers.join(" "), null);
        return;
      }
      const outstanding = p.unmatchedLedger.length;
      const message = `Mark this account reconciled from ${p.periodStart} to ${p.periodEnd}? Statement balance ${fmt(p.statementBalance)}, ledger balance ${fmt(p.ledgerBalance)}${
        outstanding > 0 ? `, with ${outstanding} explained ledger item(s) not yet on the statement` : ""
      }. Nothing can be posted to this bank account inside the period afterwards unless it is reopened.`;
      if (!(await ask(message, { confirmLabel: "Mark reconciled" }))) return;
      await markReconciled({ bankAccountId, periodEnd: reconcileEnd });
      await load();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to mark reconciled", null);
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen(reconciliationId: string) {
    await run(async () => {
      await reopenReconciliation({ reconciliationId, reason: reopenReason });
      setShowReopen(false);
      setReopenReason("");
    }, "Failed to reopen");
  }

  if (!workspace && loading) return <p className="text-sm text-[var(--text-secondary)]">Loading...</p>;
  if (!workspace) return null;

  const latest = history[0];
  const isLocked = latest?.status === "reconciled";
  const lockedThrough = history.filter((h) => h.status === "reconciled").reduce((m, h) => (h.periodEnd > m ? h.periodEnd : m), "");
  const lockedOn = (date: string) => Boolean(lockedThrough) && date <= lockedThrough;
  const hasStatement = workspace.statementLines.length > 0;

  const rows: Row[] = workspace.statementLines.map((line) => {
    if (line.matchStatus !== "unmatched") return { line, state: "matched", entries: workspace.matches[line.matchId ?? ""] ?? [], suggestion: null };
    const suggestion = suggestions[line.id] ?? null;
    return { line, state: suggestion ? (suggestion.tier === "exact" ? "exact" : "likely") : "none", entries: [], suggestion };
  });
  const todo = rows.filter((r) => r.state !== "matched");
  const exactCount = todo.filter((r) => r.state === "exact" && !lockedOn(r.line.transactionDate)).length;
  const shown = rows.filter((r) => (filter === "todo" ? r.state !== "matched" : filter === "matched" ? r.state === "matched" : true));
  const unmatchedBank = workspace.statementLines.filter((l) => l.matchStatus === "unmatched");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {bankAccounts.length > 1 ? (
          <div className="flex items-center gap-2">
            <label className="text-sm text-[var(--text-secondary)]">Bank Account:</label>
            <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className="rounded border border-[var(--card-border)] bg-[var(--card-bg)] px-2 py-1.5 text-sm text-[var(--text-primary)]">
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <span />
        )}
        <button type="button" onClick={() => setShowUpload(true)} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)]">
          Upload Statement
        </button>
      </div>

      <div className="grid gap-4 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5 sm:grid-cols-3">
        <div>
          <p className="text-xs text-[var(--text-secondary)]">Balance per bank statement</p>
          <p className="text-xl font-semibold tabular-nums text-[var(--text-primary)]">{fmt(workspace.statementBalance)}</p>
          <p className="text-xs text-[var(--text-secondary)]">{lockedThrough ? <>Reconciled up to <D value={lockedThrough} /></> : "Not reconciled yet"}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-secondary)]">Balance per your books</p>
          <p className="text-xl font-semibold tabular-nums text-[var(--text-primary)]">{fmt(workspace.ledgerBalance)}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-secondary)]">Difference</p>
          <p className={`text-xl font-semibold tabular-nums ${Math.abs(workspace.difference) < 0.005 ? "text-green-700" : "text-red-600"}`}>{fmt(workspace.difference)}</p>
          <p className="text-xs text-[var(--text-secondary)]">{differenceText(workspace.difference, hasStatement)}</p>
          {hasStatement && Math.abs(workspace.difference) >= 0.005 && (
            <button type="button" onClick={() => setShowDifference(true)} className="mt-1 text-xs text-[var(--color-primary)] hover:underline">
              Why is there a difference?
            </button>
          )}
        </div>
      </div>

      {isLocked && (
        <div className="flex items-center justify-between rounded border border-[var(--status-action-border)] bg-[var(--status-action-bg)] px-4 py-2 text-sm text-[var(--status-action-text)]">
          <span>
            Reconciled through <D value={latest.periodEnd} /> by an admin on <DT value={latest.reconciledAt} dateOnly />.
          </span>
          <button type="button" onClick={() => setShowReopen(true)} className="underline">
            Reopen
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full bg-[var(--surface-muted-bg)] p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-4 py-1.5 text-sm transition-colors ${filter === f.key ? "bg-[var(--card-bg)] font-medium text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
            >
              {f.label}
              {f.key === "todo" && todo.length > 0 ? ` (${todo.length})` : ""}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--status-success-text)]" /> Exact match</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--status-action-text)]" /> Likely match, needs your OK</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--status-critical-text)]" /> Nothing found</span>
          {exactCount > 0 && (
            <button type="button" disabled={busy} onClick={() => okAll(exactCount)} className="rounded bg-[var(--color-primary)] px-3 py-1 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
              OK all {exactCount} exact
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {shown.map((r, i) => {
          const days = Math.floor((new Date(today).getTime() - new Date(r.line.transactionDate).getTime()) / 86400000);
          const locked = lockedOn(r.line.transactionDate);
          const match = r.state === "matched" ? r.entries : r.suggestion ? [{ date: r.suggestion.entryDate, text: r.suggestion.memo || r.suggestion.description || r.suggestion.referenceNumber || "Ledger entry", amount: r.suggestion.signedAmount }] : [];
          return (
            <div key={r.line.id} className="grid grid-cols-[2rem_1fr_1fr] items-stretch gap-2 lg:grid-cols-[2rem_1fr_1fr_11rem]">
              <div className="flex items-center justify-center text-xs text-[var(--text-secondary)]">{i + 1}</div>
              <div className={`rounded-lg border px-3 py-2 text-sm ${TONE[r.state]}`}>
                <p className="text-xs opacity-80">
                  <D value={r.line.transactionDate} />
                  {r.state !== "matched" && days > OLD_AFTER_DAYS ? ` · ${days} days old` : ""}
                </p>
                <p className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">{r.line.description || "—"}</span>
                  <span className="shrink-0 tabular-nums">{fmt(r.line.amount)}</span>
                </p>
              </div>
              <div className={`rounded-lg border px-3 py-2 text-sm ${TONE[r.state]}`}>
                {match.length === 0 ? (
                  <p className="flex h-full items-center justify-center">No transaction found</p>
                ) : (
                  match.map((m, k) => (
                    <div key={k}>
                      <p className="text-xs opacity-80">
                        <D value={m.date} />
                        {r.state === "likely" && r.suggestion ? ` · ${r.suggestion.score}% sure` : ""}
                      </p>
                      <p className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate">{m.text}</span>
                        <span className="shrink-0 tabular-nums">{fmt(m.amount)}</span>
                      </p>
                    </div>
                  ))
                )}
              </div>
              <div className="col-span-3 flex items-center justify-end gap-2 lg:col-span-1 lg:flex-col lg:items-stretch lg:justify-center">
                {r.state === "matched" ? (
                  <>
                    <StatusPill tone="success">Matched</StatusPill>
                    <button type="button" disabled={busy || locked} onClick={() => unmatchLine(r.line)} className="text-xs text-red-600 hover:underline disabled:opacity-40">
                      Undo match
                    </button>
                  </>
                ) : (
                  <>
                    {r.suggestion && (
                      <button type="button" disabled={busy || locked} onClick={() => confirmSuggested(r.line, r.suggestion!)} className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-40">
                        OK
                      </button>
                    )}
                    <button type="button" disabled={busy || locked} onClick={() => setFindingFor(r.line)} className="rounded border border-[var(--card-border)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-muted-bg)] disabled:opacity-40">
                      Find or create
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {shown.length === 0 && (
          <p className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-6 text-center text-sm text-[var(--text-secondary)]">
            {!hasStatement ? "No statement transactions imported yet. Upload your bank statement to begin." : filter === "todo" ? "Nothing left to do. Every bank line is matched." : "Nothing here."}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-[var(--card-border)] pt-4">
        <p className="text-xs text-[var(--text-secondary)]">{history.length > 0 ? `${history.length} past reconciliation${history.length === 1 ? "" : "s"} on record` : "No reconciliations recorded yet"}</p>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[var(--text-secondary)]">Reconcile up to</label>
          <DatePicker max={today} value={reconcileEnd} onChange={setReconcileEnd} className="w-36 rounded border border-gray-300 bg-white px-2 py-1 text-sm" />
          <button type="button" disabled={busy} onClick={handleMarkReconciled} className="rounded bg-gray-900 px-4 py-1.5 text-sm text-white hover:bg-gray-800 disabled:opacity-50">
            Mark Reconciled
          </button>
        </div>
      </div>

      {dialog}

      {showUpload && <UploadStatementModal bankAccountId={bankAccountId} onClose={() => setShowUpload(false)} onImported={load} />}
      {findingFor && (
        <FindMatchPanel
          bankAccountId={bankAccountId}
          line={findingFor}
          ledger={workspace.unmatchedLedger}
          locked={lockedOn(findingFor.transactionDate)}
          onClose={() => setFindingFor(null)}
          onMatched={load}
          onCreate={() => {
            setCreatingForLine(findingFor);
            setFindingFor(null);
          }}
        />
      )}
      {creatingForLine && <CreateBankTransactionModal bankAccountId={bankAccountId} line={creatingForLine} offsetAccounts={offsetAccounts} onClose={() => setCreatingForLine(null)} onCreated={load} />}
      {showDifference && (
        <DifferencePanel
          statementBalance={workspace.statementBalance}
          ledgerBalance={workspace.ledgerBalance}
          unmatchedBank={unmatchedBank}
          unmatchedLedger={workspace.unmatchedLedger}
          locked={lockedOn}
          onClassify={(l) => {
            setShowDifference(false);
            setClassifyingLine(l);
          }}
          onClose={() => setShowDifference(false)}
        />
      )}
      {classifyingLine && <ClassifyLedgerModal bankAccountId={bankAccountId} line={classifyingLine} onClose={() => setClassifyingLine(null)} onClassified={load} />}

      {showReopen && latest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowReopen(false)} />
          <div className="relative w-full max-w-sm space-y-3 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5 shadow-lg">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Reopen reconciliation</h2>
            <p className="text-xs text-[var(--text-secondary)]">Admin-only. This is recorded with your name, the time, and the reason below.</p>
            <textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Reason for reopening" className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm" rows={3} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowReopen(false)} className="rounded px-4 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-muted-bg)]">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !reopenReason.trim()}
                onClick={() => handleReopen(latest.id)}
                className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
              >
                Reopen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
