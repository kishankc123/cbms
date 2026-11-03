"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordExpensePayment } from "./actions";
import { InvoicePaymentModal } from "../purchases/invoice-payment-modal";
import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/field";

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
  const [pending, setPending] = useState<{ accountId: string; amount: number; modeId?: string | null }[] | null>(null);
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
        <Modal
          size="sm"
          title="Record payment"
          onClose={() => setPending(null)}
          dismissible={!saving}
          footer={
            <>
              <Button onClick={() => setPending(null)} disabled={saving}>
                No
              </Button>
              <Button variant="primary" onClick={confirm} loading={saving} disabled={!payDate}>
                Yes
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-[13px] text-ink">Record this payment against expense {expenseNumber}?</p>
            <Field label="Payment date">
              <DatePicker max={todayIso()} value={payDate} onChange={setPayDate} className={`${controlClass} w-full`} />
            </Field>
          </div>
        </Modal>
      )}
      {error && (
        <Modal size="sm" title="Could not record the payment" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>OK</Button>}>
          <p className="text-[13px] text-[var(--danger-text)]">{error}</p>
        </Modal>
      )}
    </>
  );
}
