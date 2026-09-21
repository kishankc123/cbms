"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { D } from "@/components/calendar/date-text";

type Info = {
  noteNumber: string;
  voided: boolean;
  total: number;
  applied: number;
  available: number;
  targets: { id: string; number: string; date: string; outstanding: number }[];
  applications: { id: string; targetId: string; targetNumber: string; amount: number }[];
};

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

/**
 * Applies the credit on a sales return (debit note) to the customer's open invoices, or on a purchase return
 * (credit note) to the supplier's open bills, so the document shows what is really still owed. Nothing is posted to
 * the ledger — the return already did that; this only settles the document.
 */
export function ApplyCreditModal({
  title,
  documentWord,
  load,
  onApply,
  onRemove,
  onClose,
}: {
  title: string;
  documentWord: "invoice" | "bill";
  load: () => Promise<Info>;
  onApply: (allocations: { targetId: string; amount: number }[]) => Promise<void>;
  onRemove: (applicationId: string) => Promise<void>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const { problem, report, dialog } = useProblem();

  async function refresh() {
    setInfo(await load());
    setAmounts({});
  }

  useEffect(() => {
    let cancelled = false;
    load()
      .then((i) => !cancelled && setInfo(i))
      .catch((e) => !cancelled && report(e instanceof Error ? e.message : "Could not load the credit", null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !problem) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, problem]);

  const entered = Object.values(amounts).reduce((s, v) => s + (parseFloat(v) || 0), 0);

  function fillFrom(id: string, outstanding: number) {
    if (!info) return;
    const others = Object.entries(amounts)
      .filter(([k]) => k !== id)
      .reduce((s, [, v]) => s + (parseFloat(v) || 0), 0);
    const room = Math.max(info.available - others, 0);
    setAmounts((p) => ({ ...p, [id]: Math.min(outstanding, room).toFixed(2) }));
  }

  async function apply() {
    const allocations = Object.entries(amounts)
      .map(([targetId, v]) => ({ targetId, amount: parseFloat(v) || 0 }))
      .filter((a) => a.amount > 0);
    if (allocations.length === 0) return report(`Enter an amount against at least one ${documentWord}.`, "[data-amount]");
    if (info && entered > info.available + 0.005) return report(`Only ${fmt(info.available)} of credit is left — the amounts add up to ${fmt(entered)}.`, "[data-amount]");
    setSaving(true);
    try {
      await onApply(allocations);
      await refresh();
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not apply the credit", "[data-amount]");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setSaving(true);
    try {
      await onRemove(id);
      await refresh();
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not take the credit back", null);
    } finally {
      setSaving(false);
    }
  }

  const canApply = info && !info.voided && info.available > 0.005 && info.targets.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-xl space-y-4 rounded-lg bg-white p-5 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        {!info && <p className="text-sm text-gray-500">Loading...</p>}

        {info && (
          <>
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <span className="text-gray-500">Note </span>
                <span className="font-mono text-gray-900">{info.noteNumber}</span>
              </div>
              <div>
                <span className="text-gray-500">Credit </span>
                <span className="font-medium text-gray-900">{fmt(info.total)}</span>
              </div>
              <div>
                <span className="text-gray-500">Applied </span>
                <span className="font-medium text-gray-900">{fmt(info.applied)}</span>
              </div>
              <div>
                <span className="text-gray-500">Left </span>
                <span className="font-bold text-gray-900">{fmt(info.available)}</span>
              </div>
            </div>

            {info.applications.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-semibold text-gray-700">Already applied</h3>
                <ul className="divide-y divide-gray-100 rounded border border-gray-200 text-sm">
                  {info.applications.map((a) => (
                    <li key={a.id} className="flex items-center justify-between px-3 py-1.5">
                      <span>
                        <span className="font-mono">{a.targetNumber}</span> — {fmt(a.amount)}
                      </span>
                      <button type="button" disabled={saving} onClick={() => remove(a.id)} className="text-xs text-red-600 hover:underline disabled:opacity-50">
                        Take back
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {info.voided ? (
              <p className="text-sm text-gray-500">This note is void, so its credit can&apos;t be applied.</p>
            ) : info.available <= 0.005 ? (
              <p className="text-sm text-gray-500">All of this credit has been applied.</p>
            ) : info.targets.length === 0 ? (
              <p className="text-sm text-gray-500">There are no open {documentWord}s to apply it to.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-xs font-medium">{documentWord === "invoice" ? "Invoice" : "Bill"}</th>
                      <th className="px-2 py-1.5 text-left text-xs font-medium">Date</th>
                      <th className="px-2 py-1.5 text-right text-xs font-medium">Still owed</th>
                      <th className="px-2 py-1.5 text-right text-xs font-medium">Apply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {info.targets.map((t) => (
                      <tr key={t.id} className="border-t border-gray-100">
                        <td className="px-2 py-1 font-mono text-xs">{t.number}</td>
                        <td className="px-2 py-1 text-gray-500">
                          <D value={t.date} />
                        </td>
                        <td className="px-2 py-1 text-right">{fmt(t.outstanding)}</td>
                        <td className="px-2 py-1 text-right">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            data-amount
                            value={amounts[t.id] ?? ""}
                            onChange={(e) => setAmounts((p) => ({ ...p, [t.id]: e.target.value }))}
                            onFocus={() => !amounts[t.id] && fillFrom(t.id, t.outstanding)}
                            className="w-24 rounded border border-gray-300 bg-white px-1.5 py-1 text-right text-sm"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              {canApply && <span className="mr-auto text-xs text-gray-500">Entered {fmt(entered)}</span>}
              <button type="button" onClick={onClose} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Close
              </button>
              {canApply && (
                <button
                  type="button"
                  onClick={apply}
                  disabled={saving}
                  className="rounded bg-[var(--color-primary)] px-5 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
                >
                  {saving ? "Applying..." : "Apply credit"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {dialog}
    </div>
  );
}
