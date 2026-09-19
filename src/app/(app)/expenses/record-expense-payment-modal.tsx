"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordExpensePayment } from "./actions";
import { InvoicePaymentModal } from "../purchases/invoice-payment-modal";
import { ConfirmDialog } from "../sales/confirm-dialog";

type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };

// Settles an already-posted expense's outstanding balance — a distinct
// action from editing the expense itself, and never creates a second
// expense (see recordExpensePayment).
export function RecordExpensePaymentModal({
  expenseId,
  expenseNumber,
  remaining,
  cashBankAccounts,
  onClose,
}: {
  expenseId: string;
  expenseNumber: string;
  remaining: number;
  cashBankAccounts: CashBankGroup[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<{ accountId: string; amount: number }[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!pending) return;
    setSaving(true);
    setError(null);
    try {
      await recordExpensePayment({ expenseId, payments: pending });
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record payment");
      setPending(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {!pending && (
        <InvoicePaymentModal
          total={remaining}
          cashBankAccounts={cashBankAccounts}
          saving={saving}
          onCancel={onClose}
          onConfirm={(payments) => setPending(payments)}
        />
      )}
      {pending && (
        <ConfirmDialog
          message={`Record this payment against expense ${expenseNumber}?`}
          onYes={confirm}
          onNo={() => setPending(null)}
        />
      )}
      {error && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={onClose} />
          <div className="relative w-full max-w-sm rounded-lg bg-white p-5 shadow-lg space-y-4 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-6 py-1.5"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </>
  );
}
