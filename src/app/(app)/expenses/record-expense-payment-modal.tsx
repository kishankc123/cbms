"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordExpensePayment } from "./actions";
import { InvoicePaymentModal } from "../purchases/invoice-payment-modal";
import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";

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
  const [payDate, setPayDate] = useState(todayIso());
  const [pending, setPending] = useState<{ accountId: string; amount: number }[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!pending) return;
    setSaving(true);
    setError(null);
    try {
      await recordExpensePayment({ expenseId, payments: pending, paymentDate: payDate });
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
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setPending(null)} />
          <div className="relative w-full max-w-sm space-y-4 rounded-lg bg-white p-5 shadow-lg">
            <p className="text-sm text-gray-900">Record this payment against expense {expenseNumber}?</p>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Payment date</label>
              <DatePicker
                max={todayIso()}
                value={payDate}
                onChange={setPayDate}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPending(null)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                No
              </button>
              <button type="button" onClick={confirm} disabled={saving || !payDate} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
                Yes
              </button>
            </div>
          </div>
        </div>
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
