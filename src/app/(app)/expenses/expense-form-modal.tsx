"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createExpense, updateExpense, type ExpenseInput, type ExpenseTaxTreatment } from "./actions";
import { ConfirmDialog } from "../sales/confirm-dialog";
import { InvoicePaymentModal } from "../purchases/invoice-payment-modal";

import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
type Vendor = { id: string; name: string };
type CategoryAccount = { id: string; code: string; name: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type PaymentLine = { accountId: string; amount: number };

const TAX_TREATMENTS: { value: ExpenseTaxTreatment; label: string }[] = [
  { value: "taxable", label: "Taxable" },
  { value: "exempt", label: "Exempt" },
  { value: "zero_rated", label: "Zero-rated" },
];

const today = () => todayIso();
const round2 = (n: number) => Math.round(n * 100) / 100;

export type InitialExpense = ExpenseInput & { expenseId: string; expenseNumber: string };

// New Expense and Edit Expense share one form — sections mirror the spec:
// Expense Information, Invoice/Supporting Document, Tax Information, Amount
// (computed, read-only), Settlement.
export function ExpenseFormModal({
  vendors,
  categoryAccounts,
  cashBankAccounts,
  vatRate,
  tdsRate,
  initial,
  onClose,
}: {
  vendors: Vendor[];
  categoryAccounts: CategoryAccount[];
  cashBankAccounts: CashBankGroup[];
  vatRate: number;
  tdsRate: number;
  initial?: InitialExpense;
  onClose: () => void;
}) {
  const router = useRouter();
  const [expenseDate, setExpenseDate] = useState(initial?.expenseDate ?? today());
  const [categoryAccountId, setCategoryAccountId] = useState(initial?.categoryAccountId ?? "");
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? "");
  const [payeeName, setPayeeName] = useState(initial?.payeeName ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(initial?.invoiceNumber ?? "");
  const [invoiceDate, setInvoiceDate] = useState(initial?.invoiceDate ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [taxTreatment, setTaxTreatment] = useState<ExpenseTaxTreatment>(initial?.taxTreatment ?? "taxable");
  const [taxableAmount, setTaxableAmount] = useState(initial ? String(initial.taxableAmount) : "");
  const [vatAmount, setVatAmount] = useState(initial ? String(initial.vatAmount) : "0.00");
  const [tdsAmount, setTdsAmount] = useState(initial ? String(initial.tdsAmount) : "0.00");
  const [otherTaxAmount, setOtherTaxAmount] = useState(initial ? String(initial.otherTaxAmount) : "0");
  const [vatTouched, setVatTouched] = useState(Boolean(initial));
  const [tdsTouched, setTdsTouched] = useState(Boolean(initial));
  const [payments, setPayments] = useState<PaymentLine[]>(initial?.payments ?? []);
  const [showPayment, setShowPayment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);

  // Auto-fills VAT/TDS from the tenant's configured rates as the taxable
  // amount or treatment changes — never hard-coded, and the user can still
  // type their own figure, which then stops the auto-fill for that field.
  useEffect(() => {
    const amount = parseFloat(taxableAmount) || 0;
    if (!vatTouched) {
      const rate = taxTreatment === "taxable" ? vatRate : 0;
      setVatAmount(round2(amount * (rate / 100)).toFixed(2));
    }
    if (!tdsTouched) {
      setTdsAmount(round2(amount * (tdsRate / 100)).toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxableAmount, taxTreatment]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !showPayment && !confirmSave) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, showPayment, confirmSave]);

  const accountLabels: Record<string, string> = {};
  for (const g of cashBankAccounts) {
    if (g.children.length === 0) accountLabels[g.id] = g.name;
    else for (const c of g.children) accountLabels[c.id] = c.name;
  }

  const subtotal = round2(parseFloat(taxableAmount) || 0);
  const vat = round2(parseFloat(vatAmount) || 0);
  const tds = round2(parseFloat(tdsAmount) || 0);
  const otherTax = round2(parseFloat(otherTaxAmount) || 0);
  const total = round2(subtotal + vat + otherTax);
  const amountPayable = round2(total - tds);
  const paidTotal = round2(payments.reduce((s, p) => s + p.amount, 0));
  const remaining = Math.max(round2(amountPayable - paidTotal), 0);

  function handleSaveClick() {
    setSaveError(null);
    if (!categoryAccountId) {
      setSaveError("Select an expense category");
      return;
    }
    if (!vendorId && !payeeName.trim()) {
      setSaveError("Select a supplier or enter a payee name");
      return;
    }
    if (subtotal <= 0) {
      setSaveError("Taxable amount must be greater than zero");
      return;
    }
    if (amountPayable < 0) {
      setSaveError("TDS and other withholdings cannot exceed the total expense amount");
      return;
    }
    setConfirmSave(true);
  }

  async function performSave() {
    setConfirmSave(false);
    setSaving(true);
    try {
      const payload: ExpenseInput = {
        expenseDate,
        categoryAccountId,
        vendorId: vendorId || null,
        payeeName,
        description,
        invoiceNumber,
        invoiceDate,
        dueDate,
        taxTreatment,
        taxableAmount: subtotal,
        vatAmount: vat,
        tdsAmount: tds,
        otherTaxAmount: otherTax,
        payments,
      };

      if (initial) {
        await updateExpense({ ...payload, expenseId: initial.expenseId });
      } else {
        const result = await createExpense(payload);
        if (result.warnings.length > 0) {
          alert(`Saved, but flagged by Rules & Policies:\n\n${result.warnings.join("\n")}`);
        }
      }
      router.refresh();
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative w-full max-w-3xl rounded-lg bg-white p-5 shadow-lg space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{initial ? `Edit expense ${initial.expenseNumber}` : "New expense"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Expense Information</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Expense number</label>
              <input
                disabled
                value={initial?.expenseNumber ?? "Auto-generated on save"}
                className="w-full rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm text-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Expense date</label>
              <DatePicker max={today()} value={expenseDate} onChange={(v) => setExpenseDate(v)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Expense category</label>
              <select
                value={categoryAccountId}
                onChange={(e) => setCategoryAccountId(e.target.value)}
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
              <label className="block text-xs text-gray-500 mb-1">Payee / Supplier</label>
              <select
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">Not a registered supplier</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              {!vendorId && (
                <input
                  value={payeeName}
                  onChange={(e) => setPayeeName(e.target.value)}
                  placeholder="Payee name"
                  className="mt-2 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              )}
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
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Invoice / Supporting Document</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Invoice number (optional)</label>
              <input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Invoice date</label>
              <DatePicker max={today()} value={invoiceDate} onChange={(v) => setInvoiceDate(v)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Due date (optional)</label>
              <DatePicker value={dueDate} onChange={(v) => setDueDate(v)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Tax Information</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Taxable amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={taxableAmount}
                onChange={(e) => setTaxableAmount(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tax treatment</label>
              <select
                value={taxTreatment}
                onChange={(e) => setTaxTreatment(e.target.value as ExpenseTaxTreatment)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                {TAX_TREATMENTS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div />
            <div>
              <label className="block text-xs text-gray-500 mb-1">VAT ({vatRate}% default)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={vatAmount}
                onChange={(e) => {
                  setVatTouched(true);
                  setVatAmount(e.target.value);
                }}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">TDS ({tdsRate}% default)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={tdsAmount}
                onChange={(e) => {
                  setTdsTouched(true);
                  setTdsAmount(e.target.value);
                }}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Other applicable tax</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={otherTaxAmount}
                onChange={(e) => setOtherTaxAmount(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>
        </section>

        <section className="flex flex-wrap justify-center gap-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-700">Amount</h3>
            <div className="w-64 rounded-lg border border-gray-300 bg-white p-4 space-y-1 text-sm text-gray-900">
              <div className="flex items-center justify-between">
                <span>Subtotal</span>
                <span>{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>VAT</span>
                <span>{vat.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Other tax</span>
                <span>{otherTax.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-gray-200 pt-1 font-medium">
                <span>Total expense</span>
                <span>{total.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-gray-600">
                <span>TDS withheld</span>
                <span>-{tds.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-gray-200 pt-1 font-bold">
                <span>Amount payable</span>
                <span>{amountPayable.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-700">Settlement</h3>
            <div className="w-64 rounded-lg border border-gray-300 bg-white p-4 space-y-2">
              {payments.length === 0 && remaining <= 0 && <p className="text-sm text-gray-400">Unpaid</p>}
              {payments.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-sm text-gray-900">
                  <span>{accountLabels[p.accountId] ?? "Account"}</span>
                  <span>{p.amount.toFixed(2)}</span>
                </div>
              ))}
              {remaining > 0 && (
                <div className="flex items-center justify-between text-sm text-gray-900">
                  <span>Expense Payable (unpaid)</span>
                  <span>{remaining.toFixed(2)}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-sm">
                <span className="font-medium text-gray-900">Amount payable</span>
                <span className="font-bold text-gray-900">{amountPayable.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </section>

        <div className="flex items-center justify-end gap-3">
          {saveError && <span className="text-xs text-red-600">{saveError}</span>}
          <button
            type="button"
            onClick={() => setShowPayment(true)}
            disabled={amountPayable <= 0}
            className="whitespace-nowrap rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
          >
            {payments.length > 0 ? "EDIT PAY" : "RECORD PAY"}
          </button>
          <button
            type="button"
            onClick={handleSaveClick}
            disabled={saving}
            className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
          >
            {saving ? "Saving..." : "SAVE"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-4 py-1.5 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>

        {confirmSave && (
          <ConfirmDialog message="Do you want to save?" onYes={performSave} onNo={() => setConfirmSave(false)} />
        )}

        {showPayment && (
          <InvoicePaymentModal
            total={amountPayable}
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
    </div>
  );
}
