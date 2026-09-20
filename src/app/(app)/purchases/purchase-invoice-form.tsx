"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPurchaseInvoice, updatePurchaseInvoice, type CashBillType } from "./actions";
import { InfoDialog } from "../inventory/info-dialog";
import { InvoicePaymentModal } from "./invoice-payment-modal";

import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
type Vendor = { id: string; name: string };
type Item = { id: string; name: string; purchasePrice: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type PaymentLine = { accountId: string; amount: number };

type LineRow = {
  itemId: string;
  description: string;
  rate: string;
  quantity: string;
  discount: string;
};

const BILL_TYPE_OPTIONS: { value: CashBillType; label: string }[] = [
  { value: "no_bill", label: "No bill" },
  { value: "vat", label: "VAT" },
  { value: "pan", label: "PAN" },
  { value: "estimate", label: "Estimate" },
];

const MIN_LINES = 4;
const fmt = (n: number) => n.toFixed(2);
const today = () => todayIso();
const emptyLine = (): LineRow => ({ itemId: "", description: "", rate: "", quantity: "", discount: "0" });

// VAT only applies when the invoice is marked as a VAT bill — a PAN,
// Estimate, or No bill invoice books the taxable amount with no VAT.
function computeLine(line: LineRow, vatRate: number) {
  const rate = parseFloat(line.rate) || 0;
  const quantity = parseFloat(line.quantity) || 0;
  const discount = parseFloat(line.discount) || 0;
  const gross = rate * quantity;
  const taxable = Math.max(gross - discount, 0);
  const vat = taxable * (vatRate / 100);
  const total = taxable + vat;
  return { gross, taxable, vat, total };
}

function isLineComplete(line: LineRow) {
  return Boolean((parseFloat(line.rate) || 0) > 0 && (parseFloat(line.quantity) || 0) > 0);
}

function isLineTouched(line: LineRow) {
  return Boolean(line.itemId || line.description.trim() || line.rate || (parseFloat(line.quantity) || 0) > 0);
}

export type InitialInvoice = {
  billId: string;
  invoiceNumber: string;
  invoiceDate: string;
  vendorId: string;
  billType: CashBillType;
  lines: { itemId: string | null; description: string; rate: number; quantity: number; discount: number }[];
  payments: PaymentLine[];
};

type FieldErrors = { invoiceNumber?: string; date?: string; vendorId?: string; items?: string };

const inputCls =
  "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";
const inputErrCls =
  "w-full rounded border border-red-400 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-400";
const cellInputCls =
  "rounded border border-gray-300 bg-white px-1.5 py-1 text-sm text-right focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";
const calculatedCellCls = "rounded bg-gray-50 px-1.5 py-1 text-sm text-right text-gray-600";

export function PurchaseInvoiceForm({
  vendors,
  items,
  cashBankAccounts,
  vatRate,
  initial,
  onDone,
  onDirtyChange,
}: {
  vendors: Vendor[];
  items: Item[];
  cashBankAccounts: CashBankGroup[];
  vatRate: number;
  initial?: InitialInvoice;
  onDone?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [invoiceDate, setInvoiceDate] = useState(initial?.invoiceDate ?? today());
  const [invoiceNumber, setInvoiceNumber] = useState(initial?.invoiceNumber ?? "");
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? "");
  const [billType, setBillType] = useState<CashBillType>(initial?.billType ?? "no_bill");
  const [lines, setLines] = useState<LineRow[]>(() =>
    initial && initial.lines.length > 0
      ? initial.lines.map((l) => ({
          itemId: l.itemId ?? "",
          description: l.description,
          rate: String(l.rate),
          quantity: String(l.quantity),
          discount: String(l.discount),
        }))
      : Array.from({ length: MIN_LINES }, emptyLine)
  );
  const [payments, setPayments] = useState<PaymentLine[]>(initial?.payments ?? []);
  const [showPayment, setShowPayment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSavedDialog, setShowSavedDialog] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!showPayment) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowPayment(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showPayment]);

  useEffect(() => {
    if (!onDirtyChange) return;
    const dirty = Boolean(
      invoiceNumber.trim() ||
        vendorId ||
        payments.length > 0 ||
        lines.some(isLineTouched) ||
        (initial && invoiceDate !== initial.invoiceDate)
    );
    onDirtyChange(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceNumber, vendorId, payments, lines]);

  function updateLine(i: number, field: keyof LineRow, value: string) {
    setLines((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l;
        if (field === "itemId") {
          const item = items.find((it) => it.id === value);
          return {
            ...l,
            itemId: value,
            description: item ? item.name : l.description,
            rate: item ? item.purchasePrice : l.rate,
          };
        }
        return { ...l, [field]: value };
      })
    );
  }

  function handleAddLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function handleDeleteLine(i: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  const effectiveVatRate = billType === "vat" ? vatRate : 0;
  const computedLines = lines.map((l) => computeLine(l, effectiveVatRate));
  const grandGross = computedLines.reduce((s, c) => s + c.gross, 0);
  const grandTaxable = computedLines.reduce((s, c) => s + c.taxable, 0);
  const grandVat = computedLines.reduce((s, c) => s + c.vat, 0);
  const grandTotal = computedLines.reduce((s, c) => s + c.total, 0);
  const grandDiscount = lines.reduce((s, l) => s + (parseFloat(l.discount) || 0), 0);
  const paidTotal = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(grandTotal - paidTotal, 0);
  const paymentStatus = paidTotal <= 0 ? "Unpaid" : remaining <= 0.005 ? "Paid" : "Partially paid";

  async function performSave() {
    const errors: FieldErrors = {};
    if (!invoiceNumber.trim()) errors.invoiceNumber = "Invoice number is required.";
    if (!invoiceDate) errors.date = "Please enter the invoice date.";
    if (!vendorId) errors.vendorId = "Please select a supplier.";
    if (!lines.some(isLineComplete)) errors.items = "Add at least one item line with a valid rate and quantity.";
    setFieldErrors(errors);
    setSaveError(null);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const payload = {
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        vendorId,
        billType,
        lines: lines.filter(isLineComplete).map((l) => ({
          itemId: l.itemId || null,
          description: l.description.trim(),
          rate: parseFloat(l.rate) || 0,
          quantity: parseFloat(l.quantity) || 0,
          discount: parseFloat(l.discount) || 0,
        })),
        payments,
      };

      if (initial) {
        await updatePurchaseInvoice({ ...payload, billId: initial.billId });
      } else {
        await createPurchaseInvoice(payload);
      }

      if (onDone) {
        onDone();
      } else {
        setInvoiceDate(today());
        setInvoiceNumber("");
        setVendorId("");
        setBillType("no_bill");
        setLines(Array.from({ length: MIN_LINES }, emptyLine));
        setPayments([]);
        setShowSavedDialog(true);
      }
      onDirtyChange?.(false);
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Invoice Details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date</label>
            <DatePicker max={today()} value={invoiceDate} onChange={(v) => {
                setInvoiceDate(v);
                if (fieldErrors.date) setFieldErrors((p) => ({ ...p, date: undefined }));
              }} className={fieldErrors.date ? inputErrCls : inputCls} />
            {fieldErrors.date && <p className="mt-1 text-xs text-red-600">{fieldErrors.date}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Invoice Number</label>
            <input
              value={invoiceNumber}
              onChange={(e) => {
                setInvoiceNumber(e.target.value);
                if (fieldErrors.invoiceNumber) setFieldErrors((p) => ({ ...p, invoiceNumber: undefined }));
              }}
              className={fieldErrors.invoiceNumber ? inputErrCls : inputCls}
            />
            {fieldErrors.invoiceNumber && <p className="mt-1 text-xs text-red-600">{fieldErrors.invoiceNumber}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Supplier</label>
            <select
              value={vendorId}
              onChange={(e) => {
                setVendorId(e.target.value);
                if (fieldErrors.vendorId) setFieldErrors((p) => ({ ...p, vendorId: undefined }));
              }}
              className={fieldErrors.vendorId ? inputErrCls : inputCls}
            >
              <option value="">Select supplier</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            {fieldErrors.vendorId && <p className="mt-1 text-xs text-red-600">{fieldErrors.vendorId}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Bill Type</label>
            <select value={billType} onChange={(e) => setBillType(e.target.value as CashBillType)} className={inputCls}>
              {BILL_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Invoice Items</h2>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-1.5 py-1.5 font-semibold text-xs whitespace-nowrap">Item</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-right whitespace-nowrap">Rate</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-right whitespace-nowrap">Qty</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-right whitespace-nowrap">Gross</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-right whitespace-nowrap">Discount</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-right whitespace-nowrap">Taxable</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-right whitespace-nowrap">VAT</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-right whitespace-nowrap">Total</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const c = computedLines[i];
                return (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-1 py-1">
                      <select
                        value={line.itemId}
                        onChange={(e) => updateLine(i, "itemId", e.target.value)}
                        className="w-[9.6rem] rounded border border-gray-300 bg-white px-1.5 py-1 text-sm"
                      >
                        <option value="">Select product</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.rate}
                        onChange={(e) => updateLine(i, "rate", e.target.value)}
                        className={`w-20 ${cellInputCls}`}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.quantity}
                        onChange={(e) => updateLine(i, "quantity", e.target.value)}
                        className={`w-16 ${cellInputCls}`}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <div className={`w-20 ${calculatedCellCls}`}>{fmt(c.gross)}</div>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.discount}
                        onChange={(e) => updateLine(i, "discount", e.target.value)}
                        className={`w-20 ${cellInputCls}`}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <div className={`w-20 ${calculatedCellCls}`}>{fmt(c.taxable)}</div>
                    </td>
                    <td className="px-1 py-1">
                      <div className={`w-20 ${calculatedCellCls}`}>{fmt(c.vat)}</div>
                    </td>
                    <td className="px-1 py-1">
                      <div className="w-20 rounded bg-gray-50 px-1.5 py-1 text-sm text-right font-medium text-gray-900">
                        {fmt(c.total)}
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <button
                        type="button"
                        onClick={() => handleDeleteLine(i)}
                        className="text-xs text-gray-400 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button type="button" onClick={handleAddLine} className="mt-2 text-sm text-gray-600 hover:text-gray-900">
          + Add Item
        </button>
        {fieldErrors.items && <p className="mt-1 text-xs text-red-600">{fieldErrors.items}</p>}
      </section>

      <div className="flex flex-wrap gap-4">
        <section className="w-72 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Invoice Summary</h2>
          <div className="space-y-1 text-sm text-gray-900">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Gross</span>
              <span>{fmt(grandGross)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Discount</span>
              <span>{fmt(grandDiscount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Taxable</span>
              <span>{fmt(grandTaxable)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">VAT</span>
              <span>{fmt(grandVat)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 pt-1.5 mt-1.5">
              <span className="font-semibold text-gray-900">Total</span>
              <span className="text-base font-bold text-gray-900">{fmt(grandTotal)}</span>
            </div>
          </div>
        </section>

        <section className="w-72 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Settlement</h2>
          <div className="space-y-1 text-sm text-gray-900">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Payment Status</span>
              <span
                className={
                  paymentStatus === "Paid"
                    ? "font-medium text-green-700"
                    : paymentStatus === "Partially paid"
                      ? "font-medium text-amber-700"
                      : "font-medium text-gray-500"
                }
              >
                {paymentStatus}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Paid Amount</span>
              <span>{fmt(paidTotal)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 pt-1.5 mt-1.5">
              <span className="font-semibold text-gray-900">Outstanding</span>
              <span className="text-base font-bold text-gray-900">{fmt(remaining)}</span>
            </div>
          </div>
        </section>
      </div>

      <div className="flex items-center justify-end gap-3">
        {saveError && <span className="text-xs text-red-600">{saveError}</span>}
        <button
          type="button"
          onClick={() => setShowPayment(true)}
          className="whitespace-nowrap rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-4 py-1.5"
        >
          {payments.length > 0 ? "Edit Pay" : "Record Pay"}
        </button>
        <button
          type="button"
          onClick={performSave}
          disabled={saving}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium px-5 py-1.5 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            disabled={saving}
            className="rounded text-gray-500 hover:text-gray-700 text-sm px-2 py-1.5 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>

      {showSavedDialog && (
        <InfoDialog message="Purchase invoice saved successfully." onOk={() => setShowSavedDialog(false)} />
      )}

      {showPayment && (
        <InvoicePaymentModal
          total={grandTotal}
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
