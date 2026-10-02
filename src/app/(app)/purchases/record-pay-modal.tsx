"use client";

import { useEffect, useState } from "react";

type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type Vendor = { id: string; name: string };
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

// Payment for a Consumable purchase. Nothing is assumed paid: the amount starts empty, and whatever isn't covered
// is owed to the supplier — so a supplier can be chosen here, and is required once the payments fall short.
export function RecordPayModal({
  total,
  cashBankAccounts,
  allVendors,
  vendorBalances,
  initialVendorId,
  initialLines,
  saving,
  onCancel,
  onConfirm,
}: {
  total: number;
  cashBankAccounts: CashBankGroup[];
  allVendors: Vendor[];
  vendorBalances: Record<string, number>;
  initialVendorId: string;
  initialLines?: { accountId: string; amount: number }[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: (payments: { accountId: string; amount: number }[], vendorId: string) => void;
}) {
  const [lines, setLines] = useState<PaymentLine[]>(() =>
    initialLines && initialLines.length > 0
      ? initialLines.map((l) => ({ accountId: l.accountId, amount: String(l.amount) }))
      : [{ accountId: firstSelectableId(cashBankAccounts), amount: "" }]
  );
  const [vendorId, setVendorId] = useState(initialVendorId);

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
  const difference = total - totalEntered;
  const overpaid = difference < -0.004;
  const partial = difference > 0.004;
  const vendorRequired = partial && !vendorId;
  const selectedVendor = allVendors.find((v) => v.id === vendorId);

  function handleConfirm() {
    if (overpaid || vendorRequired) return;
    const payments = lines
      .filter((l) => l.accountId && (parseFloat(l.amount) || 0) > 0)
      .map((l) => ({ accountId: l.accountId, amount: parseFloat(l.amount) || 0 }));
    onConfirm(payments, vendorId);
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
          Bill total: <span className="font-medium text-gray-900">{total.toFixed(2)}</span>
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
            <span className="text-gray-600">{partial ? "Balance due (credit)" : overpaid ? "Overpaid" : "Difference"}</span>
            <span className={`font-medium ${partial ? "text-amber-600" : overpaid ? "text-red-600" : "text-green-600"}`}>{Math.abs(difference).toFixed(2)}</span>
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Supplier{" "}
            {partial ? <span className="text-red-600">(required — the balance is owed to the supplier)</span> : <span className="text-gray-400">(optional when paid in full)</span>}
          </label>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">Select supplier</option>
            {allVendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        {selectedVendor && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-700">{selectedVendor.name}</span>
            <span className="text-gray-900">{(vendorBalances[selectedVendor.id] ?? 0).toFixed(2)}</span>
          </div>
        )}

        {overpaid && <p className="text-xs text-red-600">The amount entered can&apos;t be more than the bill total.</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || overpaid || vendorRequired}
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
