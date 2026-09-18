"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSalesInvoiceForEdit, updateSalesInvoice } from "./actions";
import { PaymentModal } from "./payment-modal";

type Customer = { id: string; name: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type PaymentLine = { accountId: string; amount: number };

export function EditInvoiceModal({
  invoiceId,
  customers,
  cashBankAccounts,
  customerBalances,
  vatRate,
  onClose,
}: {
  invoiceId: string;
  customers: Customer[];
  cashBankAccounts: CashBankGroup[];
  customerBalances: Record<string, number>;
  vatRate: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invoiceDate, setInvoiceDate] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [grossAmount, setGrossAmount] = useState("");
  const [discountAmount, setDiscountAmount] = useState("0");
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [showPayment, setShowPayment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSalesInvoiceForEdit(invoiceId)
      .then((data) => {
        if (cancelled) return;
        setInvoiceDate(data.invoiceDate);
        setCustomerId(data.customerId);
        setGrossAmount(String(data.grossAmount));
        setDiscountAmount(String(data.discountAmount));
        setPayments(data.payments);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Failed to load invoice");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !showPayment) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, showPayment]);

  const gross = parseFloat(grossAmount) || 0;
  const discount = parseFloat(discountAmount) || 0;
  const taxable = Math.max(gross - discount, 0);
  const total = taxable + taxable * (vatRate / 100);

  async function handleSave() {
    setSaveError(null);
    if (!invoiceDate) {
      setSaveError("Invoice date is required.");
      return;
    }
    if (gross <= 0) {
      setSaveError("Gross amount must be greater than zero.");
      return;
    }
    setSaving(true);
    try {
      await updateSalesInvoice({
        invoiceId,
        invoiceDate,
        customerId,
        grossAmount: gross,
        discountAmount: discount,
        payments,
      });
      router.refresh();
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative w-full max-w-lg rounded-lg bg-white p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Edit invoice</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        {loading && <p className="text-sm text-gray-500">Loading...</p>}
        {loadError && <p className="text-sm text-red-600">{loadError}</p>}

        {!loading && !loadError && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date</label>
                <input
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Customer</label>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">Select customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Gross amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={grossAmount}
                  onChange={(e) => setGrossAmount(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Discount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowPayment(true)}
              className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs px-3 py-1.5"
            >
              {payments.length > 0 ? "EDIT PAY" : "RECORD PAY"}
            </button>

            <div className="flex justify-end gap-2 pt-2">
              {saveError && <span className="mr-auto self-center text-xs text-red-600">{saveError}</span>}
              <button
                type="button"
                onClick={onClose}
                className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </>
        )}
      </div>

      {showPayment && (
        <PaymentModal
          grandTotal={total}
          cashBankAccounts={cashBankAccounts}
          allCustomers={customers}
          customerBalances={customerBalances}
          initialCustomerId={customerId}
          initialLines={payments}
          saving={false}
          onCancel={() => setShowPayment(false)}
          onConfirm={(p, cId) => {
            setPayments(p);
            if (cId) setCustomerId(cId);
            setShowPayment(false);
          }}
        />
      )}
    </div>
  );
}
