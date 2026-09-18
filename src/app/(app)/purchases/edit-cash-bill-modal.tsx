"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCashPurchaseForEdit, updateCashPurchase, type CashBillType } from "./actions";
import { RecordPayModal } from "./record-pay-modal";
import { BILL_TYPE_OPTIONS } from "./consumable-purchase-form";

type Vendor = { id: string; name: string };
type Account = { id: string; code: string; name: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type PaymentLine = { accountId: string; amount: number };

export function EditCashBillModal({
  billId,
  vendors,
  categoryAccounts,
  cashBankAccounts,
  vatRate,
  onClose,
}: {
  billId: string;
  vendors: Vendor[];
  categoryAccounts: Account[];
  cashBankAccounts: CashBankGroup[];
  vatRate: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [billType, setBillType] = useState<CashBillType>("no_bill");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [showPayment, setShowPayment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCashPurchaseForEdit(billId)
      .then((data) => {
        if (cancelled) return;
        setBillNumber(data.billNumber);
        setBillDate(data.billDate);
        setVendorId(data.vendorId ?? "");
        setCategoryId(data.categoryId);
        setBillType(data.billType);
        setDescription(data.description);
        setAmount(String(data.amount));
        setPayments(data.payments);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Failed to load bill");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [billId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !showPayment) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, showPayment]);

  const enteredAmount = parseFloat(amount) || 0;
  const tax = billType === "vat" ? enteredAmount * (vatRate / 100) : 0;
  const total = enteredAmount + tax;

  async function handleSave() {
    setSaveError(null);
    if (!categoryId || enteredAmount <= 0 || payments.length === 0) {
      setSaveError("Category, amount, and payment are required.");
      return;
    }
    setSaving(true);
    try {
      await updateCashPurchase({
        billId,
        billNumber,
        billDate,
        vendorId,
        categoryId,
        billType,
        description,
        amount: enteredAmount,
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
          <h2 className="text-base font-semibold text-gray-900">Edit consumable purchase</h2>
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
                <label className="block text-xs text-gray-500 mb-1">Bill no</label>
                <input
                  value={billNumber}
                  onChange={(e) => setBillNumber(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date</label>
                <input
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Supplier</label>
                <select
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">Select supplier</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Category</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">Select category</option>
                  {categoryAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Bill type</label>
                <select
                  value={billType}
                  onChange={(e) => setBillType(e.target.value as CashBillType)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {BILL_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Description</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
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
        <RecordPayModal
          total={total}
          cashBankAccounts={cashBankAccounts}
          initialLines={payments}
          saving={false}
          onCancel={() => setShowPayment(false)}
          onConfirm={(p) => {
            setPayments(p);
            setShowPayment(false);
          }}
        />
      )}
    </div>
  );
}
