"use client";

import { useEffect, useState } from "react";

type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type Customer = { id: string; name: string };
type PaymentLine = { accountId: string; amount: string };

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

export function PaymentModal({
  grandTotal,
  cashBankAccounts,
  allCustomers,
  customerBalances,
  initialCustomerId,
  initialLines,
  saving,
  onCancel,
  onConfirm,
}: {
  grandTotal: number;
  cashBankAccounts: CashBankGroup[];
  allCustomers: Customer[];
  customerBalances: Record<string, number>;
  initialCustomerId: string;
  initialLines?: { accountId: string; amount: number }[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: (payments: { accountId: string; amount: number }[], customerId: string) => void;
}) {
  const [lines, setLines] = useState<PaymentLine[]>(() =>
    initialLines && initialLines.length > 0
      ? initialLines.map((l) => ({ accountId: l.accountId, amount: String(l.amount) }))
      : [{ accountId: firstSelectableId(cashBankAccounts), amount: "" }]
  );
  const [customerId, setCustomerId] = useState(initialCustomerId);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  function updateLine(i: number, field: keyof PaymentLine, value: string) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }

  const totalEntered = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const difference = grandTotal - totalEntered;
  const mismatch = Math.abs(difference) > 0.004;
  const customerRequired = mismatch && !customerId;
  const selectedCustomer = allCustomers.find((c) => c.id === customerId);

  function handleConfirm() {
    if (customerRequired) return;
    const payments = lines
      .filter((l) => l.accountId && (parseFloat(l.amount) || 0) > 0)
      .map((l) => ({ accountId: l.accountId, amount: parseFloat(l.amount) || 0 }));
    onConfirm(payments, customerId);
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
          Invoice total: <span className="font-medium text-gray-900">{grandTotal.toFixed(2)}</span>
        </p>

        <div className="space-y-2">
          {lines.map((line, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={line.accountId}
                onChange={(e) => updateLine(i, "accountId", e.target.value)}
                className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">Select account</option>
                {cashBankAccounts.map((g) =>
                  g.children.length === 0 ? (
                    <option key={g.id} value={g.id} className="font-bold">
                      {g.code} — {g.name}
                    </option>
                  ) : (
                    <optgroup key={g.id} label={`${g.code} — ${g.name}`}>
                      {g.children.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </optgroup>
                  )
                )}
              </select>
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
          onClick={() => setLines((prev) => [...prev, { accountId: firstSelectableId(cashBankAccounts), amount: "" }])}
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
            <span className="text-gray-600">{difference > 0 ? "Balance due (credit)" : difference < 0 ? "Overpaid" : "Difference"}</span>
            <span className={`font-medium ${difference > 0 ? "text-amber-600" : difference < 0 ? "text-blue-600" : "text-green-600"}`}>
              {Math.abs(difference).toFixed(2)}
            </span>
          </div>
        </div>

        {mismatch && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Customer <span className="text-red-600">(required — amount doesn&apos;t match the total)</span>
            </label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">Select customer</option>
              {allCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {selectedCustomer && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-700">{selectedCustomer.name}</span>
            <span className="text-gray-900">{(customerBalances[selectedCustomer.id] ?? 0).toFixed(2)}</span>
          </div>
        )}

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
            disabled={saving || customerRequired}
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
