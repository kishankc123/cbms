"use client";

import { useEffect, useState } from "react";
import {
  getReconciliationWorkspace,
  getSuggestedMatchesForAccount,
  confirmMatch,
  unmatch,
  markReconciled,
  reopenReconciliation,
  listReconciliationHistory,
  type StatementLineRow,
  type UnmatchedLedgerRow,
} from "./actions";
import type { MatchCandidate } from "@/lib/banking/matching";
import { UploadStatementModal } from "./upload-statement-modal";
import { CreateBankTransactionModal } from "./create-bank-transaction-modal";
import { ClassifyLedgerModal } from "./classify-ledger-modal";

type BankAccountOption = { id: string; label: string };
type OffsetAccount = { id: string; code: string; name: string; category: string };
type Workspace = Awaited<ReturnType<typeof getReconciliationWorkspace>>;
type Reconciliation = Awaited<ReturnType<typeof listReconciliationHistory>>[number];

const TABS = ["all", "matched", "suggested", "unmatched_bank", "unmatched_ledger", "exceptions"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  all: "All",
  matched: "Matched",
  suggested: "Suggested Matches",
  unmatched_bank: "Unmatched Bank",
  unmatched_ledger: "Unmatched Ledger",
  exceptions: "Exceptions",
};

const EXCEPTION_DAYS = 15;
const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: "bad" | "good" }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone === "bad" ? "text-red-600" : tone === "good" ? "text-green-600" : "text-gray-900"}`}>{value}</p>
    </div>
  );
}

export function ReconciliationWorkspace({ bankAccounts, offsetAccounts }: { bankAccounts: BankAccountOption[]; offsetAccounts: OffsetAccount[] }) {
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? "");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, MatchCandidate>>({});
  const [history, setHistory] = useState<Reconciliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");
  const [showUpload, setShowUpload] = useState(false);
  const [creatingForLine, setCreatingForLine] = useState<StatementLineRow | null>(null);
  const [classifyingLine, setClassifyingLine] = useState<UnmatchedLedgerRow | null>(null);
  const [selectedBankLines, setSelectedBankLines] = useState<Set<string>>(new Set());
  const [selectedLedgerLines, setSelectedLedgerLines] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showReopen, setShowReopen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  const today = new Date().toISOString().slice(0, 10);

  async function load() {
    if (!bankAccountId) return;
    setLoading(true);
    setActionError(null);
    try {
      const [ws, sugg, hist] = await Promise.all([
        getReconciliationWorkspace(bankAccountId),
        getSuggestedMatchesForAccount(bankAccountId),
        listReconciliationHistory(bankAccountId),
      ]);
      setWorkspace(ws);
      setSuggestions(sugg);
      setHistory(hist);
      setSelectedBankLines(new Set());
      setSelectedLedgerLines(new Set());
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankAccountId]);

  function toggleBankLine(id: string) {
    setSelectedBankLines((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleLedgerLine(id: string) {
    setSelectedLedgerLines((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirmSuggested(line: StatementLineRow, candidate: MatchCandidate) {
    setBusy(true);
    setActionError(null);
    try {
      await confirmMatch({
        bankAccountId,
        statementLineIds: [line.id],
        journalLineIds: [candidate.journalLineId],
        matchType: candidate.tier,
        confidence: candidate.score,
      });
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to confirm match");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnmatch(matchId: string | null) {
    if (!matchId) return;
    setBusy(true);
    setActionError(null);
    try {
      await unmatch(matchId);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to unmatch");
    } finally {
      setBusy(false);
    }
  }

  async function handleManualMatch() {
    if (selectedBankLines.size === 0 || selectedLedgerLines.size === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      await confirmMatch({
        bankAccountId,
        statementLineIds: [...selectedBankLines],
        journalLineIds: [...selectedLedgerLines],
        matchType: "manual",
      });
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to match — check the selected amounts agree");
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkReconciled() {
    if (!workspace) return;
    if (!confirm("Mark this bank account reconciled as of today?")) return;
    setBusy(true);
    setActionError(null);
    try {
      const start = history[0]?.periodEnd ?? "2000-01-01";
      await markReconciled({ bankAccountId, periodStart: start, periodEnd: today });
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to mark reconciled");
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen(reconciliationId: string) {
    setBusy(true);
    setActionError(null);
    try {
      await reopenReconciliation({ reconciliationId, reason: reopenReason });
      setShowReopen(false);
      setReopenReason("");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to reopen");
    } finally {
      setBusy(false);
    }
  }

  if (!workspace && loading) return <p className="text-sm text-gray-400">Loading...</p>;
  if (!workspace) return null;

  const latest = history[0];
  const isLocked = latest?.status === "reconciled";

  const unmatchedBank = workspace.statementLines.filter((l) => l.matchStatus !== "matched");
  const suggestedRows = unmatchedBank.filter((l) => suggestions[l.id]);
  const trueUnmatchedBank = unmatchedBank.filter((l) => !suggestions[l.id]);
  const exceptions = unmatchedBank.filter((l) => {
    const days = (new Date(today).getTime() - new Date(l.transactionDate).getTime()) / 86400000;
    return days > EXCEPTION_DAYS;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Bank Account:</label>
          <select
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            {bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => setShowUpload(true)}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
        >
          Upload Statement
        </button>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <SummaryCard label="Bank Statement Balance" value={fmt(workspace.statementBalance)} />
        <SummaryCard label="Ledger Balance" value={fmt(workspace.ledgerBalance)} />
        <SummaryCard label="Matched" value={fmt(workspace.matchedAmount)} tone="good" />
        <SummaryCard label="Unmatched" value={fmt(workspace.unmatchedBankAmount)} tone="bad" />
        <SummaryCard label="Difference" value={fmt(workspace.difference)} tone={Math.abs(workspace.difference) > 0.01 ? "bad" : "good"} />
      </div>

      {isLocked && (
        <div className="flex items-center justify-between rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <span>
            Reconciled through {latest.periodEnd} by an admin on {new Date(latest.reconciledAt ?? "").toLocaleDateString()}.
          </span>
          <button type="button" onClick={() => setShowReopen(true)} className="text-amber-900 underline">
            Reopen
          </button>
        </div>
      )}

      <div className="inline-flex flex-wrap rounded-full bg-gray-100 p-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              tab === t ? "bg-white text-gray-900 font-medium shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {TAB_LABELS[t]}
            {t === "suggested" && suggestedRows.length > 0 && ` (${suggestedRows.length})`}
            {t === "unmatched_bank" && trueUnmatchedBank.length > 0 && ` (${trueUnmatchedBank.length})`}
            {t === "unmatched_ledger" && workspace.unmatchedLedger.length > 0 && ` (${workspace.unmatchedLedger.length})`}
            {t === "exceptions" && exceptions.length > 0 && ` (${exceptions.length})`}
          </button>
        ))}
      </div>

      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      {tab === "all" && (
        <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 font-medium">Reference</th>
              <th className="px-4 py-2 font-medium">Amount</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {workspace.statementLines.map((l) => (
              <tr key={l.id} className="border-t border-gray-100">
                <td className="px-4 py-2">{l.transactionDate}</td>
                <td className="px-4 py-2">{l.description || "—"}</td>
                <td className="px-4 py-2">{l.reference || "—"}</td>
                <td className="px-4 py-2">{fmt(l.amount)}</td>
                <td className="px-4 py-2 capitalize">{suggestions[l.id] && l.matchStatus === "unmatched" ? "suggested" : l.matchStatus}</td>
              </tr>
            ))}
            {workspace.statementLines.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  No statement transactions imported yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {tab === "matched" && (
        <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 font-medium">Amount</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {workspace.statementLines
              .filter((l) => l.matchStatus === "matched")
              .map((l) => (
                <tr key={l.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">{l.transactionDate}</td>
                  <td className="px-4 py-2">{l.description || "—"}</td>
                  <td className="px-4 py-2">{fmt(l.amount)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      disabled={busy || isLocked}
                      onClick={() => handleUnmatch(l.matchId)}
                      className="text-xs text-red-600 hover:underline disabled:opacity-40"
                    >
                      Unmatch
                    </button>
                  </td>
                </tr>
              ))}
            {workspace.statementLines.filter((l) => l.matchStatus === "matched").length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  Nothing matched yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {tab === "suggested" && (
        <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Bank line</th>
              <th className="px-4 py-2 font-medium">Amount</th>
              <th className="px-4 py-2 font-medium">Suggested ledger match</th>
              <th className="px-4 py-2 font-medium">Confidence</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {suggestedRows.map((l) => {
              const c = suggestions[l.id];
              return (
                <tr key={l.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">
                    {l.transactionDate} — {l.description || "—"}
                  </td>
                  <td className="px-4 py-2">{fmt(l.amount)}</td>
                  <td className="px-4 py-2">
                    {c.entryDate} — {c.memo || c.description || "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span className={c.tier === "exact" ? "text-green-600 font-medium" : "text-amber-600"}>
                      {c.tier === "exact" ? "Exact" : "Suggested"} ({c.score}%)
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      disabled={busy || isLocked}
                      onClick={() => handleConfirmSuggested(l, c)}
                      className="text-xs text-[var(--color-primary)] hover:underline disabled:opacity-40"
                    >
                      Confirm match
                    </button>
                  </td>
                </tr>
              );
            })}
            {suggestedRows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  No suggested matches
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {tab === "unmatched_bank" && (
        <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium"></th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 font-medium">Reference</th>
              <th className="px-4 py-2 font-medium">Amount</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {trueUnmatchedBank.map((l) => (
              <tr key={l.id} className="border-t border-gray-100">
                <td className="px-4 py-2">
                  <input type="checkbox" checked={selectedBankLines.has(l.id)} onChange={() => toggleBankLine(l.id)} disabled={isLocked} />
                </td>
                <td className="px-4 py-2">{l.transactionDate}</td>
                <td className="px-4 py-2">{l.description || "—"}</td>
                <td className="px-4 py-2">{l.reference || "—"}</td>
                <td className="px-4 py-2">{fmt(l.amount)}</td>
                <td className="px-4 py-2 text-right">
                  <p className="text-xs text-gray-400 mb-1">Bank transaction not found in ledger</p>
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => setCreatingForLine(l)}
                    className="text-xs text-[var(--color-primary)] hover:underline disabled:opacity-40"
                  >
                    Create Transaction
                  </button>
                </td>
              </tr>
            ))}
            {trueUnmatchedBank.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                  Nothing unmatched
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {tab === "unmatched_ledger" && (
        <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium"></th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 font-medium">Amount</th>
              <th className="px-4 py-2 font-medium">Classification</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {workspace.unmatchedLedger.map((l) => (
              <tr key={l.journalLineId} className="border-t border-gray-100">
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={selectedLedgerLines.has(l.journalLineId)}
                    onChange={() => toggleLedgerLine(l.journalLineId)}
                    disabled={isLocked}
                  />
                </td>
                <td className="px-4 py-2">{l.entryDate}</td>
                <td className="px-4 py-2">{l.memo || l.description || "—"}</td>
                <td className="px-4 py-2">{fmt(l.signedAmount)}</td>
                <td className="px-4 py-2 capitalize">{l.classification?.replace(/_/g, " ") ?? "—"}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => setClassifyingLine(l)}
                    className="text-xs text-gray-600 hover:underline disabled:opacity-40"
                  >
                    Classify
                  </button>
                </td>
              </tr>
            ))}
            {workspace.unmatchedLedger.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                  Nothing unmatched
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {tab === "exceptions" && (
        <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 font-medium">Amount</th>
              <th className="px-4 py-2 font-medium">Days outstanding</th>
            </tr>
          </thead>
          <tbody>
            {exceptions.map((l) => {
              const days = Math.floor((new Date(today).getTime() - new Date(l.transactionDate).getTime()) / 86400000);
              return (
                <tr key={l.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">{l.transactionDate}</td>
                  <td className="px-4 py-2">{l.description || "—"}</td>
                  <td className="px-4 py-2">{fmt(l.amount)}</td>
                  <td className="px-4 py-2 text-red-600">{days} days</td>
                </tr>
              );
            })}
            {exceptions.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  No exceptions
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {(selectedBankLines.size > 0 || selectedLedgerLines.size > 0) && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg border border-gray-300 bg-white shadow-lg px-5 py-3 flex items-center gap-4 text-sm">
          <span>
            {selectedBankLines.size} bank line{selectedBankLines.size === 1 ? "" : "s"} · {selectedLedgerLines.size} ledger line
            {selectedLedgerLines.size === 1 ? "" : "s"} selected
          </span>
          <button
            type="button"
            disabled={busy || selectedBankLines.size === 0 || selectedLedgerLines.size === 0}
            onClick={handleManualMatch}
            className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-40"
          >
            Match selected
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedBankLines(new Set());
              setSelectedLedgerLines(new Set());
            }}
            className="text-gray-500 hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-gray-200 pt-4">
        <p className="text-xs text-gray-500">
          {history.length > 0 ? `${history.length} past reconciliation${history.length === 1 ? "" : "s"} on record` : "No reconciliations recorded yet"}
        </p>
        {!isLocked && (
          <button
            type="button"
            disabled={busy}
            onClick={handleMarkReconciled}
            className="rounded bg-gray-900 hover:bg-gray-800 text-white text-sm px-4 py-1.5 disabled:opacity-50"
          >
            Mark Reconciled
          </button>
        )}
      </div>

      {showUpload && <UploadStatementModal bankAccountId={bankAccountId} onClose={() => setShowUpload(false)} onImported={load} />}
      {creatingForLine && (
        <CreateBankTransactionModal
          bankAccountId={bankAccountId}
          line={creatingForLine}
          offsetAccounts={offsetAccounts}
          onClose={() => setCreatingForLine(null)}
          onCreated={load}
        />
      )}
      {classifyingLine && (
        <ClassifyLedgerModal bankAccountId={bankAccountId} line={classifyingLine} onClose={() => setClassifyingLine(null)} onClassified={load} />
      )}

      {showReopen && latest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowReopen(false)} />
          <div className="relative w-full max-w-sm rounded-lg bg-white p-5 shadow-lg space-y-3">
            <h2 className="text-base font-semibold text-gray-900">Reopen reconciliation</h2>
            <p className="text-xs text-gray-500">Admin-only. This is recorded with your name, the time, and the reason below.</p>
            <textarea
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="Reason for reopening"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowReopen(false)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !reopenReason.trim()}
                onClick={() => handleReopen(latest.id)}
                className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
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
