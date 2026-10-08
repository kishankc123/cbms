"use client";

import { useEffect, useState } from "react";
import { PaymentModeSelect } from "@/components/payment-mode-select";

type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type PaymentLine = { modeId: string; accountId: string; amount: string };

// A group with sub-groups is shown as a locked (unselectable) heading — only
// its sub-groups are selectable settlement accounts. A group with none is
// itself selectable directly.
function firstSelectableId(groups: CashBankGroup[]): string {
  for (const g of groups) {
    if (g.children.length === 0) return g.id;
    if (g.children[0]) return g.children[0].id;
  }
  return "";
}

// Unlike RecordPayModal (used for Consumable purchases, which are always
// fully settled), a Stockable invoice can be paid partially — whatever isn't
// covered here is left on Accounts Payable, so entered amounts only need to
// be <= the total, not exactly equal to it.
export function InvoicePaymentModal({
  total,
  cashBankAccounts,
  initialLines,
  saving,
  onCancel,
  onConfirm,
}: {
  total: number;
  cashBankAccounts: CashBankGroup[];
  initialLines?: { accountId: string; amount: number; modeId?: string | null }[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: (payments: { accountId: string; amount: number; modeId?: string | null }[]) => void;
}) {
  const [lines, setLines] = useState<PaymentLine[]>(() =>
    initialLines && initialLines.length > 0
      ? initialLines.map((l) => ({ modeId: l.modeId ?? "", accountId: l.accountId, amount: String(l.amount) }))
      : [{ modeId: "", accountId: firstSelectableId(cashBankAccounts), amount: total > 0 ? String(total) : "" }]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  function updateLine(i: number, field: "amount", value: string) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }

  const totalEntered = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const remaining = Math.max(total - totalEntered, 0);
  const overpaid = totalEntered - total > 0.004;

  function handleConfirm() {
    if (overpaid) return;
    const payments = lines
      .filter((l) => l.accountId && (parseFloat(l.amount) || 0) > 0)
      .map((l) => ({ accountId: l.accountId, amount: parseFloat(l.amount) || 0, modeId: l.modeId || null }));
    onConfirm(payments);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />

      <div className="relative w-full max-w-md rounded-lg bg-white p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Record payment</h2>
          <button type="button" onClick={onCancel} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <p className="text-sm text-gray-600">
          Invoice total: <span className="font-medium text-gray-900">{total.toFixed(2)}</span>
        </p>

        <div className="space-y-2">
          {lines.map((line, i) => (
            <div key={i} className="flex items-center gap-2">
              <PaymentModeSelect
                value={{ modeId: line.modeId, accountId: line.accountId }}
                onChange={(v) => setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...v } : l)))}
                className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                value={line.amount}
                onChange={(e) => updateLine(i, "amount", e.target.value)}
                placeholder="Amount"
                className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setLines((prev) => [...prev, { modeId: "", accountId: firstSelectableId(cashBankAccounts), amount: "" }])}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          + Add other payment option
        </button>

        <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-600">Amount entered</span>
            <span className="font-medium text-gray-900">{totalEntered.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">{remaining > 0 ? "Remaining (on credit)" : "Difference"}</span>
            <span className={`font-medium ${remaining > 0 ? "text-amber-600" : "text-green-600"}`}>
              {remaining.toFixed(2)}
            </span>
          </div>
        </div>

        {overpaid && <p className="text-xs text-red-600">Amount entered cannot exceed the invoice total.</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || overpaid}
            onClick={handleConfirm}
            className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
