"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";

type Info = {
  number: string;
  voided: boolean;
  outstanding: number;
  advanceAvailable: number;
  applications: { id: string; amount: number }[];
};

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

/**
 * Applies the advance a customer has paid (or a supplier we have paid) to one invoice (or bill). Advances are also
 * applied automatically, oldest document first, whenever an invoice or bill is created — this is for doing it by hand
 * (for example when an advance arrives after the invoice) and for taking one back.
 */
export function ApplyAdvanceModal({
  title,
  documentWord,
  partyWord,
  load,
  onApply,
  onRemove,
  onClose,
}: {
  title: string;
  documentWord: "invoice" | "bill";
  partyWord: "customer" | "supplier";
  load: () => Promise<Info>;
  onApply: (amount: number) => Promise<void>;
  onRemove: (applicationId: string) => Promise<void>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const { problem, report, dialog } = useProblem();

  async function refresh() {
    const i = await load();
    setInfo(i);
    setAmount("");
  }

  useEffect(() => {
    let cancelled = false;
    load()
      .then((i) => {
        if (cancelled) return;
        setInfo(i);
        setAmount(Math.max(Math.min(i.outstanding, i.advanceAvailable), 0).toFixed(2));
      })
      .catch((e) => !cancelled && report(e instanceof Error ? e.message : "Could not load the advance", null));
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

  async function run(action: () => Promise<void>, failure: string, target: string | null) {
    setSaving(true);
    try {
      await action();
      await refresh();
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : failure, target);
    } finally {
      setSaving(false);
    }
  }

  function apply() {
    const value = parseFloat(amount) || 0;
    if (!(value > 0)) return report("Enter the amount of advance to apply.", "[data-advance-amount]");
    if (info && value > info.outstanding + 0.005) return report(`Only ${fmt(info.outstanding)} is still owed on this ${documentWord}.`, "[data-advance-amount]");
    if (info && value > info.advanceAvailable + 0.005) return report(`Only ${fmt(Math.max(info.advanceAvailable, 0))} of advance is available.`, "[data-advance-amount]");
    return run(() => onApply(value), "Could not apply the advance", "[data-advance-amount]");
  }

  const canApply = info && !info.voided && info.outstanding > 0.005 && info.advanceAvailable > 0.005;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md space-y-4 rounded-lg bg-white p-5 shadow-lg">
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
                <span className="text-gray-500">{documentWord === "invoice" ? "Invoice" : "Bill"} </span>
                <span className="font-mono text-gray-900">{info.number}</span>
              </div>
              <div>
                <span className="text-gray-500">Still owed </span>
                <span className="font-medium text-gray-900">{fmt(info.outstanding)}</span>
              </div>
              <div>
                <span className="text-gray-500">Advance available </span>
                <span className="font-bold text-gray-900">{fmt(Math.max(info.advanceAvailable, 0))}</span>
              </div>
            </div>

            {info.applications.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-semibold text-gray-700">Already applied to this {documentWord}</h3>
                <ul className="divide-y divide-gray-100 rounded border border-gray-200 text-sm">
                  {info.applications.map((a) => (
                    <li key={a.id} className="flex items-center justify-between px-3 py-1.5">
                      <span>{fmt(a.amount)}</span>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => run(() => onRemove(a.id), "Could not take the advance back", null)}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        Take back
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {info.voided ? (
              <p className="text-sm text-gray-500">This {documentWord} is cancelled.</p>
            ) : info.outstanding <= 0.005 ? (
              <p className="text-sm text-gray-500">Nothing is owed on this {documentWord}.</p>
            ) : info.advanceAvailable <= 0.005 ? (
              <p className="text-sm text-gray-500">This {partyWord} has no advance left to apply.</p>
            ) : (
              <div>
                <label className="mb-1 block text-xs text-gray-500">Amount to apply</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  data-advance-amount
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
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
                  {saving ? "Applying..." : "Apply advance"}
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
