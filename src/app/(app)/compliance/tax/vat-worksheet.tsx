"use client";

import { useEffect, useState } from "react";
import { discardVatWorksheetLoad, getVatWorksheetView, loadVatWorksheetFromBooks, saveVatWorksheetDraft } from "./vat-worksheet-actions";
import { VatPeriodHover } from "./vat-period-hover";

type State = Awaited<ReturnType<typeof getVatWorksheetView>>;

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
// A receivable is shown as a negative amount in green; a payable (or nothing) in the normal colour.
const closingClass = (n: number) => (n < 0 ? "text-green-600" : "text-gray-900");
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function VatWorksheet() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Start date of the fiscal year being viewed; null = the current year (the server picks it).
  const [yearKey, setYearKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "discard" | null>(null);

  // Bumped after an action so the screen reads the worksheet again.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getVatWorksheetView(yearKey)
      .then((r) => {
        if (cancelled) return;
        setState(r);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not open the worksheet"));
    return () => {
      cancelled = true;
    };
  }, [yearKey, tick]);

  async function run(kind: "load" | "save" | "discard", fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(kind);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "That did not work.");
      setTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  if (!state) {
    return error ? (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-red-600">{error}</div>
    ) : (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">Opening the worksheet…</div>
    );
  }
  if (state.years.length === 0 || !state.selectedKey) {
    return <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">Nothing to show yet — the worksheet fills in as VAT periods are generated.</div>;
  }

  const selectedKey = state.selectedKey;
  const shown = state.draft ?? state.saved;
  const sheet = shown?.sheet ?? null;
  const rows = sheet?.rows ?? [];
  const closingCredit = rows.length ? rows[rows.length - 1].creditClosing : sheet?.openingCredit ?? 0;

  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">VAT Worksheet</h3>
          <p className="text-xs text-gray-500">
            One fiscal year at a time. Load the worksheet from your books, then save it. Only a VAT receivable (credit) is carried forward and netted off against the next period&apos;s VAT payable. Unpaid VAT payable is never carried — it stays with its own period.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Fiscal year
          <select value={selectedKey} onChange={(e) => setYearKey(e.target.value)} disabled={busy !== null} className="rounded border border-gray-300 bg-white px-2 py-1 text-sm">
            {state.years.map((y) => (
              <option key={y.key} value={y.key}>
                {y.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {state.draft ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            Loaded from the books on {when(state.draft.loadedAt)}
            {state.draft.loadedBy ? ` by ${state.draft.loadedBy}` : ""} — not saved yet.
          </span>
          {state.canEdit && (
            <span className="flex gap-2">
              <button type="button" disabled={busy !== null} onClick={() => run("save", () => saveVatWorksheetDraft(selectedKey))} className="rounded bg-[var(--color-primary)] px-3 py-1 text-sm text-white disabled:opacity-50">
                {busy === "save" ? "Saving…" : "Save worksheet"}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => run("discard", () => discardVatWorksheetLoad(selectedKey))} className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 disabled:opacity-50">
                Discard
              </button>
            </span>
          )}
        </div>
      ) : state.saved ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            <span>
              Saved on {when(state.saved.savedAt)}
              {state.saved.savedBy ? ` by ${state.saved.savedBy}` : ""}.
            </span>
            {state.canEdit && (
              <button type="button" disabled={busy !== null} onClick={() => run("load", () => loadVatWorksheetFromBooks(selectedKey))} className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 disabled:opacity-50">
                {busy === "load" ? "Loading from the books…" : "Load again"}
              </button>
            )}
          </div>
          {state.saved.booksChanged && (
            <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Sales, purchases or expenses have changed since this worksheet was saved. It still shows the saved figures — load it again and save to bring it up to date.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded border border-dashed border-gray-300 px-4 py-8 text-center">
          <p className="text-sm text-gray-600">This year&apos;s worksheet has not been loaded yet.</p>
          {state.canEdit ? (
            <button type="button" disabled={busy !== null} onClick={() => run("load", () => loadVatWorksheetFromBooks(selectedKey))} className="mt-3 rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
              {busy === "load" ? "Loading from the books… this can take a minute" : "Load worksheet"}
            </button>
          ) : (
            <p className="mt-1 text-xs text-gray-400">Ask someone who can edit compliance to load and save it.</p>
          )}
        </div>
      )}

      {sheet && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded border border-gray-200 p-3">
              <p className="text-xs text-gray-500">Opening balance</p>
              <p className="text-lg font-semibold text-gray-900">{fmt(sheet.openingCredit)}</p>
            </div>
            <div className="rounded border border-gray-200 p-3">
              <p className="text-xs text-gray-500">Closing balance</p>
              <p className={`text-lg font-semibold ${closingClass(-closingCredit)}`}>{fmt(-closingCredit || 0)}</p>
            </div>
            <div className="rounded border border-gray-200 p-3">
              <p className="text-xs text-gray-500">Payable VAT</p>
              <p className={`text-lg font-semibold ${sheet.payableVat > 0 ? "text-red-600" : "text-gray-900"}`}>{fmt(sheet.payableVat)}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500">
                  <th className="py-2 pr-3">Period</th>
                  <th className="py-2 pr-3 text-right">Net sales</th>
                  <th className="py-2 pr-3 text-right">VAT on sales</th>
                  <th className="py-2 pr-3 text-right">Net purchase</th>
                  <th className="py-2 pr-3 text-right">VAT on purchase</th>
                  <th className="py-2 pr-3 text-right">Net payable</th>
                  <th className="py-2 pr-3 text-right">Opening balance</th>
                  <th className="py-2 pl-3 text-right">Closing balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-200 bg-[var(--surface-muted-bg)] font-medium text-gray-900">
                  <td className="py-2 pr-3">Opening balance b/f</td>
                  <td className="py-2 pr-3" colSpan={5}></td>
                  <td className="py-2 pr-3 text-right">{fmt(sheet.openingCredit)}</td>
                  <td className="py-2 pl-3"></td>
                </tr>
                {rows.map((r) => (
                  <tr key={r.obligationId} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-3 text-gray-900">
                      <VatPeriodHover row={r} />
                    </td>
                    <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.netSales)}</td>
                    <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.salesVat)}</td>
                    <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.netPurchase)}</td>
                    <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.purchaseVat)}</td>
                    <td className="py-2 pr-3 text-right font-medium text-gray-900">{fmt(r.netPay)}</td>
                    <td className="py-2 pr-3 text-right text-gray-700">{fmt(r.creditOpening)}</td>
                    <td className={`py-2 pl-3 text-right font-semibold ${closingClass(r.closing)}`}>{fmt(r.closing)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-300 text-sm font-semibold text-gray-900">
                  <td className="py-2 pr-3">Total for the year</td>
                  <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.netSales)))}</td>
                  <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.salesVat)))}</td>
                  <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.netPurchase)))}</td>
                  <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.purchaseVat)))}</td>
                  <td className="py-2 pr-3 text-right">{fmt(sum(rows.map((r) => r.netPay)))}</td>
                  <td className="py-2 pr-3"></td>
                  <td className="py-2 pl-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
