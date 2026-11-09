"use client";

import { useState } from "react";
import { PaymentModeSelect } from "@/components/payment-mode-select";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { Amount } from "@/components/ui/data-table";

import { AmountInput } from "@/components/ui/amount-input";
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
    <Modal
      size="md"
      title="Record payment"
      onClose={onCancel}
      dismissible={!saving}
      footer={
        <>
          <Button onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" disabled={overpaid} loading={saving} onClick={handleConfirm}>
            Confirm
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] text-ink-2">
          Invoice total: <Amount value={total} className="font-medium text-ink" />
        </p>

        <div className="space-y-2">
          {lines.map((line, i) => (
            <div key={i} className="flex items-center gap-2">
              <PaymentModeSelect
                value={{ modeId: line.modeId, accountId: line.accountId }}
                onChange={(v) => setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...v } : l)))}
                className={`${controlClass} flex-1`}
              />
              <AmountInput type="number" step="0.01" min="0" value={line.amount} onChange={(e) => updateLine(i, "amount", e.target.value)} placeholder="Amount" className="w-28 text-right" />
            </div>
          ))}
        </div>

        <Button variant="ghost" size="sm" onClick={() => setLines((prev) => [...prev, { modeId: "", accountId: firstSelectableId(cashBankAccounts), amount: "" }])}>
          + Add other payment option
        </Button>

        <div className="space-y-1 rounded-lg border border-line bg-surface-2 p-3 text-[13px]">
          <div className="flex justify-between">
            <span className="text-ink-2">Amount entered</span>
            <Amount value={totalEntered} className="font-medium" />
          </div>
          <div className="flex justify-between">
            <span className="text-ink-2">{remaining > 0 ? "Remaining (on credit)" : "Difference"}</span>
            <Amount value={remaining} className={`font-medium ${remaining > 0 ? "text-[var(--warning-text)]" : "text-[var(--success-text)]"}`} />
          </div>
        </div>

        {overpaid && <p className="text-xs text-[var(--danger-text)]">Amount entered cannot exceed the invoice total.</p>}
      </div>
    </Modal>
  );
}
