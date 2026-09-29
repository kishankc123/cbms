"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addFiscalYear, closeFiscalYear, reopenFiscalYear, getYearEndReviewData, getReconciliationData, type getFiscalYearsPageData } from "./actions";
import { StatusPill } from "@/components/ui/status-pill";
import { D } from "@/components/calendar/date-text";
import { bsFiscalYearRange } from "@/lib/calendar";

type Data = Awaited<ReturnType<typeof getFiscalYearsPageData>>;
type Readiness = Awaited<ReturnType<typeof getYearEndReviewData>>;
type Reconciliation = Awaited<ReturnType<typeof getReconciliationData>>;
const inputCls = "rounded border border-gray-300 px-2 py-1.5 text-sm";
const fmt = (n: number) => n.toFixed(2);

const STATUS_TONE = { open: "success", closed: "pending", reopened: "critical" } as const;
const STATUS_LABEL = { open: "Open", closed: "Closed", reopened: "Reopened" } as const;

const CHECKLIST_LABELS = ["Draft sales invoices not yet posted", "Draft purchase bills not yet posted", "Trial balance is not balanced", "Balance sheet does not balance (assets ≠ liabilities + equity)", "Items with negative stock on hand"];

export function FiscalYearsManager({ data, isAdmin }: { data: Data; isAdmin: boolean }) {
  const router = useRouter();

  // Every selectable BS start year: from the registration-date floor (or 5 years back if none is on
  // file yet) through one year ahead of today's fiscal year, minus whichever ones are already added.
  // Dates are never typed — only which year, with its Shrawan 1 - Ashadh end boundaries computed here
  // for preview and computed again (the only figures that are ever trusted) on the server.
  const addedCodes = useMemo(() => new Set(data.years.map((fy) => fy.code)), [data.years]);
  const yearOptions = useMemo(() => {
    if (data.currentStartYear === null) return [];
    const from = data.floorStartYear ?? data.currentStartYear - 5;
    const to = data.currentStartYear + 1;
    const opts: { startYear: number; code: string; from: string; to: string }[] = [];
    for (let y = from; y <= to; y++) {
      const fy = bsFiscalYearRange(y);
      if (fy && !addedCodes.has(fy.label)) opts.push({ startYear: y, code: fy.label, from: fy.from, to: fy.to });
    }
    return opts;
  }, [data.currentStartYear, data.floorStartYear, addedCodes]);

  const [startYear, setStartYear] = useState<number | "">(() => {
    // Default to the earliest not-yet-added year (fills in gaps first), else the soonest one.
    return yearOptions[0]?.startYear ?? "";
  });
  const selected = yearOptions.find((o) => o.startYear === startYear) ?? null;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [reopenTarget, setReopenTarget] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");

  const [reviewTarget, setReviewTarget] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState<Readiness | null>(null);
  // null = not currently showing a reconciliation panel; "pending" = loading; "none" = loaded, but no
  // later fiscal year exists yet to reconcile against; otherwise the loaded row data.
  const [reconciliation, setReconciliation] = useState<Exclude<Reconciliation, null> | "pending" | "none" | null>(null);

  async function run(fn: () => Promise<unknown>, onOk?: () => void) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      onOk?.();
      router.refresh();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Action failed" });
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (startYear === "") return;
    const addedCode = selected?.code ?? "";
    await run(
      () => addFiscalYear({ startYear }),
      () => {
        setMessage({ tone: "ok", text: `Fiscal year ${addedCode} added.` });
        setStartYear("");
      }
    );
  }

  async function openReview(fiscalYearId: string) {
    setReviewTarget(fiscalYearId);
    setReviewData(null);
    setReconciliation(null);
    setMessage(null);
    try {
      setReviewData(await getYearEndReviewData(fiscalYearId));
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not load year-end review" });
      setReviewTarget(null);
    }
  }

  async function confirmClose() {
    if (!reviewTarget) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await closeFiscalYear(reviewTarget);
      setReconciliation(result.reconciliation ?? "none");
      router.refresh();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not close fiscal year" });
    } finally {
      setBusy(false);
    }
  }

  async function viewReconciliation(fiscalYearId: string) {
    setReviewTarget(fiscalYearId);
    setReviewData(null);
    setReconciliation("pending");
    setMessage(null);
    const result = await getReconciliationData(fiscalYearId);
    setReconciliation(result ?? "none");
  }

  function closeReviewPanel() {
    setReviewTarget(null);
    setReviewData(null);
    setReconciliation(null);
  }

  async function submitReopen(e: React.FormEvent) {
    e.preventDefault();
    if (!reopenTarget) return;
    await run(
      () => reopenFiscalYear({ fiscalYearId: reopenTarget, reason: reopenReason }),
      () => {
        setReopenTarget(null);
        setReopenReason("");
      }
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Fiscal Year</th>
              <th className="px-4 py-2 font-medium">Start</th>
              <th className="px-4 py-2 font-medium">End</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {data.years.map((fy) => (
              <tr key={fy.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium text-gray-900">{fy.code}</td>
                <td className="px-4 py-2">
                  <D value={fy.startDate} />
                </td>
                <td className="px-4 py-2">
                  <D value={fy.endDate} />
                </td>
                <td className="px-4 py-2">
                  <StatusPill tone={STATUS_TONE[fy.status]}>{STATUS_LABEL[fy.status]}</StatusPill>
                  {fy.status === "reopened" && fy.reopenReason && <div className="mt-1 text-xs text-gray-500">{fy.reopenReason}</div>}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap space-x-3">
                  {fy.status !== "closed" && (
                    <button type="button" disabled={busy} onClick={() => openReview(fy.id)} className="text-xs text-gray-600 hover:underline disabled:opacity-50">
                      Close
                    </button>
                  )}
                  {fy.status === "closed" && (
                    <button type="button" disabled={busy} onClick={() => viewReconciliation(fy.id)} className="text-xs text-gray-600 hover:underline disabled:opacity-50">
                      Opening Balance Check
                    </button>
                  )}
                  {fy.status === "closed" && isAdmin && (
                    <button type="button" disabled={busy} onClick={() => setReopenTarget(fy.id)} className="text-xs text-red-600 hover:underline disabled:opacity-50">
                      Reopen
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data.years.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  No fiscal years on record yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {reviewTarget && reviewData && !reconciliation && (
        <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">Year-End Closing — {reviewData.fiscalYear.code}</h3>

          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Closing checklist</p>
            <ul className="space-y-1 text-sm">
              {CHECKLIST_LABELS.map((label) => {
                const issue = reviewData.issues.find((i) => i.label === label);
                return (
                  <li key={label} className={issue ? "text-red-600" : "text-green-700"}>
                    {issue ? `⚠ ${issue.label} (${issue.count})` : `✓ ${label.replace("not yet posted", "posted").replace("is not balanced", "balanced").replace("does not balance (assets ≠ liabilities + equity)", "balances").replace("on hand", "— none on hand")}`}
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Financial review</p>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-t border-gray-100">
                  <td className="py-1 text-gray-600">Total Income</td>
                  <td className="py-1 text-right">{fmt(reviewData.profitAndLoss.totalIncome)}</td>
                </tr>
                <tr className="border-t border-gray-100">
                  <td className="py-1 text-gray-600">Total Expenses</td>
                  <td className="py-1 text-right">{fmt(reviewData.profitAndLoss.totalExpenses)}</td>
                </tr>
                <tr className="border-t border-gray-100 font-medium">
                  <td className="py-1">Net Profit</td>
                  <td className="py-1 text-right">{fmt(reviewData.profitAndLoss.netProfit)}</td>
                </tr>
                <tr className="border-t border-gray-200">
                  <td className="py-1 text-gray-600">Total Assets</td>
                  <td className="py-1 text-right">{fmt(reviewData.balanceSheet.totalAssets)}</td>
                </tr>
                <tr className="border-t border-gray-100">
                  <td className="py-1 text-gray-600">Total Liabilities</td>
                  <td className="py-1 text-right">{fmt(reviewData.balanceSheet.totalLiabilities)}</td>
                </tr>
                <tr className="border-t border-gray-100">
                  <td className="py-1 text-gray-600">Total Equity</td>
                  <td className="py-1 text-right">{fmt(reviewData.balanceSheet.totalEquity)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {!reviewData.canClose ? (
            <p className="text-sm text-red-600">Cannot close fiscal year. {reviewData.issues.length} issue{reviewData.issues.length === 1 ? "" : "s"} require attention above.</p>
          ) : (
            <p className="text-sm text-gray-500">Closing this fiscal year will prevent normal posting into it and it will remain closed until an administrator reopens it.</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !reviewData.canClose}
              onClick={confirmClose}
              className="rounded bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-1.5 disabled:opacity-50"
            >
              {busy ? "Closing..." : "Close Fiscal Year"}
            </button>
            <button type="button" onClick={closeReviewPanel} className="text-sm text-gray-600 hover:underline">
              Cancel
            </button>
          </div>
        </div>
      )}

      {reconciliation === "pending" && <p className="text-sm text-gray-500">Loading…</p>}

      {reconciliation === "none" && (
        <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-2">
          <p className="text-sm text-gray-500">No later fiscal year has been created yet — nothing to reconcile against.</p>
          <button type="button" onClick={closeReviewPanel} className="text-sm text-gray-600 hover:underline">
            Close
          </button>
        </div>
      )}

      {reconciliation && reconciliation !== "pending" && reconciliation !== "none" && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">Opening Balance Verification</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-1 font-medium">Account</th>
                <th className="py-1 font-medium text-right">Previous Closing</th>
                <th className="py-1 font-medium text-right">Current Opening</th>
                <th className="py-1 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.map((row) => (
                <tr key={row.label} className="border-t border-green-100">
                  <td className="py-1">{row.label}</td>
                  <td className="py-1 text-right">{fmt(row.closingBalance)}</td>
                  <td className="py-1 text-right">{fmt(row.openingBalance)}</td>
                  <td className={`py-1 text-right ${row.matched ? "text-green-700" : "text-red-600"}`}>{row.matched ? "✓ Matched" : "⚠ Mismatch"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={closeReviewPanel} className="text-sm text-gray-600 hover:underline">
            Close
          </button>
        </div>
      )}

      {reopenTarget && (
        <form onSubmit={submitReopen} className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">Reopen fiscal year</h3>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Reason (required)</label>
            <input required value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} className={`${inputCls} w-full`} placeholder="Correction of omitted purchase transaction" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-1.5 disabled:opacity-50">
              Reopen
            </button>
            <button type="button" onClick={() => setReopenTarget(null)} className="text-sm text-gray-600 hover:underline">
              Cancel
            </button>
          </div>
        </form>
      )}

      <form onSubmit={add} className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Add fiscal year</h3>
        <p className="text-xs text-gray-500">
          Nepal&apos;s fiscal year always runs Shrawan 1 – Ashadh end — pick which year; its dates are set automatically and can&apos;t be changed.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Fiscal Year</label>
            <select
              required
              value={startYear}
              onChange={(e) => setStartYear(e.target.value ? Number(e.target.value) : "")}
              className={`${inputCls} w-32`}
            >
              <option value="">Select…</option>
              {yearOptions.map((o) => (
                <option key={o.startYear} value={o.startYear}>
                  {o.code}
                </option>
              ))}
            </select>
          </div>
          {selected && (
            <div className="text-xs text-gray-500">
              <D value={selected.from} /> – <D value={selected.to} />
            </div>
          )}
          <button type="submit" disabled={busy || !selected} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium px-4 py-1.5 disabled:opacity-50">
            {busy ? "Adding..." : "Add"}
          </button>
        </div>
        {yearOptions.length === 0 && <p className="text-xs text-gray-500">Every selectable fiscal year has already been added.</p>}
      </form>

      {message && <p className={`text-sm ${message.tone === "ok" ? "text-green-700" : "text-red-600"}`}>{message.text}</p>}
    </div>
  );
}
