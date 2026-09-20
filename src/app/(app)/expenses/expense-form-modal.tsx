"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createExpense, updateExpense, type ExpenseInput, type ExpenseTaxTreatment, type ExpenseBillType } from "./actions";
import { useWithAdded } from "@/components/quick-add/use-with-added";
import { SupplierSelect } from "@/components/quick-add/pickers";
import { BillAvailableToggle } from "@/components/bill-available-toggle";
import { useProblem } from "@/components/problem-dialog";
import { ConfirmDialog } from "../sales/confirm-dialog";
import { InvoicePaymentModal } from "../purchases/invoice-payment-modal";

import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
type Vendor = { id: string; name: string };
// Only lowest-level accounts are offered; `group` is the account they sit under, if any.
type CategoryAccount = { id: string; code: string; name: string; group?: string | null };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type PaymentLine = { accountId: string; amount: number };

const TAX_TREATMENTS: { value: ExpenseTaxTreatment; label: string }[] = [
  { value: "taxable", label: "Taxable" },
  { value: "exempt", label: "Exempt" },
  { value: "zero_rated", label: "Zero-rated" },
];

const BILL_TYPES: { value: ExpenseBillType; label: string }[] = [
  { value: "no_bill", label: "No bill" },
  { value: "vat", label: "VAT" },
  { value: "pan", label: "PAN" },
  { value: "estimate", label: "Estimate" },
  { value: "challan", label: "Challan" },
];

const today = () => todayIso();
const round2 = (n: number) => Math.round(n * 100) / 100;

export type InitialExpense = ExpenseInput & { expenseId: string; expenseNumber: string };

type FieldKey = "expenseDate" | "category" | "supplier" | "billType" | "invoiceNumber" | "invoiceDate" | "dueDate" | "taxable" | "taxTreatment" | "vat" | "tds" | "pay";

// Which field a message from the server is about, so the cursor can be put there after the message is read.
function fieldForMessage(message: string): string | null {
  const rules: [RegExp, FieldKey][] = [
    [/closed period|expense date/i, "expenseDate"],
    [/bill type is VAT/i, "billType"],
    [/exempt|zero-rated/i, "taxTreatment"],
    [/invoice/i, "invoiceNumber"],
    [/due date/i, "dueDate"],
    [/category/i, "category"],
    [/supplier/i, "supplier"],
    [/taxable amount/i, "taxable"],
    [/TDS/, "tds"],
    [/payment|Cash or Bank/i, "pay"],
  ];
  const key = rules.find(([re]) => re.test(message))?.[1];
  return key ? at(key) : null;
}

// The selector of a field on this form: a marked control, or a date picker by id.
const at = (key: FieldKey) => `[data-field="${key}"], #exp-${key}`;

// New Expense and Edit Expense share one form — sections mirror the spec:
// Expense Information, Invoice/Supporting Document, Tax Information, Amount
// (computed, read-only), Settlement.
export function ExpenseFormModal({
  vendors: vendorsProp,
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
  const [vendors, addVendor] = useWithAdded(vendorsProp);
  const [expenseDate, setExpenseDate] = useState(initial?.expenseDate ?? today());
  const [categoryAccountId, setCategoryAccountId] = useState(initial?.categoryAccountId ?? "");
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(initial?.invoiceNumber ?? "");
  const [invoiceDate, setInvoiceDate] = useState(initial?.invoiceDate ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [billType, setBillType] = useState<ExpenseBillType>(initial?.billType ?? "no_bill");
  const [billAvailable, setBillAvailable] = useState(initial?.billAvailable ?? true);
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
  const [confirmSave, setConfirmSave] = useState(false);
  // Every problem is shown in a dialog that says why; closing it puts the cursor in the field that needs attention.
  const { problem, report, dialog } = useProblem();

  // Auto-fills VAT/TDS from the tenant's configured rates as the taxable
  // amount or treatment changes — never hard-coded, and the user can still
  // type their own figure, which then stops the auto-fill for that field.
  useEffect(() => {
    const amount = parseFloat(taxableAmount) || 0;
    if (billType !== "vat") {
      setVatAmount("0.00");
    } else if (!vatTouched) {
      const rate = taxTreatment === "taxable" ? vatRate : 0;
      setVatAmount(round2(amount * (rate / 100)).toFixed(2));
    }
    if (!tdsTouched) {
      setTdsAmount(round2(amount * (tdsRate / 100)).toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxableAmount, taxTreatment, billType]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !showPayment && !confirmSave && !problem) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, showPayment, confirmSave, problem]);

  // Categories that have sub-categories are shown only as group headings — the sub-categories are what can be chosen.
  const categoryGroups: { label: string | null; items: CategoryAccount[] }[] = [];
  for (const a of categoryAccounts) {
    const label = a.group ?? null;
    const g = categoryGroups.find((x) => x.label === label);
    if (g) g.items.push(a);
    else categoryGroups.push({ label, items: [a] });
  }
  categoryGroups.sort((a, b) => (a.label === null ? -1 : b.label === null ? 1 : a.label.localeCompare(b.label)));

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
    if (!categoryAccountId) return report("Select an expense category.", at("category"));
    if (subtotal <= 0) return report("Taxable amount must be greater than zero.", at("taxable"));
    if (amountPayable < 0) return report("TDS and other withholdings cannot exceed the total expense amount.", at("tds"));
    if (!vendorId && remaining > 0) {
      return report("Select a supplier: the unpaid balance needs someone it is owed to. A supplier isn't needed once the expense is paid in full.", at("supplier"));
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
        description,
        invoiceNumber,
        invoiceDate,
        dueDate,
        billType,
        billAvailable,
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
      const message = e instanceof Error ? e.message : "Failed to save";
      report(message, fieldForMessage(message));
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
              <DatePicker id="exp-expenseDate" max={today()} value={expenseDate} onChange={(v) => setExpenseDate(v)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Expense category</label>
              <select
                data-field="category"
                value={categoryAccountId}
                onChange={(e) => setCategoryAccountId(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">Select category</option>
                {categoryGroups.map((g) =>
                  g.label ? (
                    <optgroup key={g.label} label={g.label}>
                      {g.items.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : (
                    g.items.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))
                  )
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Supplier {remaining > 0 ? <span className="text-red-500">*</span> : <span className="text-gray-400">(optional once paid in full)</span>}</label>
              <div data-field="supplier" data-opens>
              <SupplierSelect
                value={vendorId}
                options={vendors}
                onChange={(id) => setVendorId(id)}
                onAdded={addVendor}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
              />
              </div>
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
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Bill type</label>
              <select data-field="billType" value={billType} onChange={(e) => setBillType(e.target.value as ExpenseBillType)} className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm">
                {BILL_TYPES.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Invoice number (optional)</label>
              <input
                data-field="invoiceNumber"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Invoice date</label>
              <DatePicker id="exp-invoiceDate" max={today()} value={invoiceDate} onChange={(v) => setInvoiceDate(v)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Due date (optional)</label>
              <DatePicker id="exp-dueDate" min={invoiceDate || expenseDate} value={dueDate} onChange={(v) => setDueDate(v)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
          </div>
          <BillAvailableToggle value={billAvailable} onChange={setBillAvailable} />
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
                data-field="taxable"
                value={taxableAmount}
                onChange={(e) => setTaxableAmount(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tax treatment</label>
              <select
                data-field="taxTreatment"
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
              <label className="block text-xs text-gray-500 mb-1">VAT ({vatRate}% default){billType !== "vat" && <span className="text-gray-400"> — VAT bill only</span>}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                data-field="vat"
                disabled={billType !== "vat"}
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
                data-field="tds"
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
          <button
            type="button"
            data-field="pay"
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

        {dialog}

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
