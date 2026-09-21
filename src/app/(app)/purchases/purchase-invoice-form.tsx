"use client";

import { useEffect, useState } from "react";
import { useOpeningDateGuard } from "@/components/inventory/opening-date";
import { useRouter } from "next/navigation";
import { useWithAdded } from "@/components/quick-add/use-with-added";
import { SupplierSelect, ItemSelect } from "@/components/quick-add/pickers";
import { BillAvailableToggle } from "@/components/bill-available-toggle";
import { useProblem } from "@/components/problem-dialog";
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
  dueDate?: string | null;
  billAvailable?: boolean | null;
  vendorId: string;
  billType: CashBillType;
  lines: { itemId: string | null; description: string; rate: number; quantity: number; discount: number }[];
  payments: PaymentLine[];
};

type FieldErrors = { invoiceNumber?: string; date?: string; dueDate?: string; vendorId?: string; items?: string };

const inputCls =
  "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";
const inputErrCls =
  "w-full rounded border border-red-400 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-400";
const cellInputCls =
  "rounded border border-gray-300 bg-white px-1.5 py-1 text-sm text-center focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";
const calculatedCellCls = "rounded bg-gray-50 px-1.5 py-1 text-sm text-center text-gray-600";

export function PurchaseInvoiceForm({
  vendors: vendorsProp,
  items: itemsProp,
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
  // Options plus anything just created with "Add new" (the server list catches up after a refresh).
  const [vendors, addVendor] = useWithAdded(vendorsProp);
  const [items, addItem] = useWithAdded(itemsProp);
  const [invoiceDate, setInvoiceDate] = useState(initial?.invoiceDate ?? today());
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [billAvailable, setBillAvailable] = useState(initial?.billAvailable ?? true);
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
  // Problems are shown in a dialog that says why; closing it puts the cursor in the field that needs attention.
  const { report, dialog } = useProblem();
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

  function updateLine(i: number, field: keyof LineRow, value: string, known?: Item) {
    setLines((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l;
        if (field === "itemId") {
          const item = known ?? items.find((it) => it.id === value);
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

  // A document dated before the Inventory Opening Date can't move stock: say so at once, and ask what to do when saving.
  const { guard: guardOpeningDate, notice: openingDateNotice } = useOpeningDateGuard(invoiceDate, lines.some((l) => Boolean(l.itemId)));

  async function performSave() {
    if (!guardOpeningDate()) return;
    const errors: FieldErrors = {};
    const first: { message: string; target: string }[] = [];
    if (!invoiceDate) {
      errors.date = "Please enter the invoice date.";
      first.push({ message: errors.date, target: "#inv-date" });
    }
    if (!invoiceNumber.trim()) {
      errors.invoiceNumber = "Invoice number is required.";
      first.push({ message: errors.invoiceNumber, target: '[data-field="invoiceNumber"]' });
    }
    if (!vendorId) {
      errors.vendorId = "Please select a supplier.";
      first.push({ message: errors.vendorId, target: '[data-field="supplier"]' });
    }
    if (dueDate && dueDate < invoiceDate) {
      errors.dueDate = "The due date can't be before the invoice date.";
      first.push({ message: errors.dueDate, target: "#inv-due" });
    }
    if (!lines.some(isLineComplete)) {
      errors.items = "Add at least one item line with a valid rate and quantity.";
      first.push({ message: errors.items, target: '[data-field="items"]' });
    }
    setFieldErrors(errors);
    if (first.length > 0) return report(first[0].message, first[0].target);

    setSaving(true);
    try {
      const payload = {
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        dueDate: dueDate || null,
        billAvailable,
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
        setDueDate("");
        setBillAvailable(true);
        setVendorId("");
        setBillType("no_bill");
        setLines(Array.from({ length: MIN_LINES }, emptyLine));
        setPayments([]);
        setShowSavedDialog(true);
      }
      onDirtyChange?.(false);
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save";
      const rules: [RegExp, string][] = [
        [/closed period|invoice date/i, "#inv-date"],
        [/already recorded|invoice number/i, '[data-field="invoiceNumber"]'],
        [/due date/i, "#inv-due"],
        [/supplier/i, '[data-field="supplier"]'],
        [/Cash or Bank|payment/i, '[data-field="pay"]'],
        [/item line|in stock/i, '[data-field="items"]'],
      ];
      report(message, rules.find(([re]) => re.test(message))?.[1] ?? null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Invoice Details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date</label>
            <DatePicker id="inv-date" max={today()} value={invoiceDate} onChange={(v) => {
                setInvoiceDate(v);
                if (fieldErrors.date) setFieldErrors((p) => ({ ...p, date: undefined }));
              }} className={fieldErrors.date ? inputErrCls : inputCls} />
            {openingDateNotice}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Invoice Number</label>
            <input
              data-field="invoiceNumber"
              value={invoiceNumber}
              onChange={(e) => {
                setInvoiceNumber(e.target.value);
                if (fieldErrors.invoiceNumber) setFieldErrors((p) => ({ ...p, invoiceNumber: undefined }));
              }}
              className={fieldErrors.invoiceNumber ? inputErrCls : inputCls}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Supplier</label>
            <div data-field="supplier" data-opens>
            <SupplierSelect
              value={vendorId}
              options={vendors}
              onChange={(id) => {
                setVendorId(id);
                if (fieldErrors.vendorId) setFieldErrors((p) => ({ ...p, vendorId: undefined }));
              }}
              onAdded={addVendor}
              className={fieldErrors.vendorId ? inputErrCls : inputCls}
            />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Due Date (optional)</label>
            <DatePicker
              id="inv-due"
              min={invoiceDate}
              value={dueDate}
              onChange={(v) => {
                setDueDate(v);
                if (fieldErrors.dueDate) setFieldErrors((p) => ({ ...p, dueDate: undefined }));
              }}
              className={fieldErrors.dueDate ? inputErrCls : inputCls}
            />
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
        <div className="mt-3">
          <BillAvailableToggle value={billAvailable} onChange={setBillAvailable} />
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Invoice Items</h2>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-center text-gray-500">
              <tr>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Item</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Rate</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Qty</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Gross</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Discount</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Taxable</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">VAT</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap">Total</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-center whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const c = computedLines[i];
                return (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-1 py-1 text-center">
                      <ItemSelect
                        value={line.itemId}
                        options={items}
                        placeholder="Select product"
                        onChange={(id) => updateLine(i, "itemId", id)}
                        onAdded={(it) => {
                          const item = { id: it.id, name: it.name, purchasePrice: it.purchasePrice };
                          addItem(item);
                          updateLine(i, "itemId", it.id, item);
                        }}
                        className="w-[13.35rem] rounded border border-gray-300 bg-white px-1.5 py-1 text-sm"
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        data-field={i === 0 ? "items" : undefined}
                        value={line.rate}
                        onChange={(e) => updateLine(i, "rate", e.target.value)}
                        className={`w-20 ${cellInputCls}`}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.quantity}
                        onChange={(e) => updateLine(i, "quantity", e.target.value)}
                        className={`w-16 ${cellInputCls}`}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <div className={`mx-auto w-20 ${calculatedCellCls}`}>{fmt(c.gross)}</div>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.discount}
                        onChange={(e) => updateLine(i, "discount", e.target.value)}
                        className={`w-20 ${cellInputCls}`}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <div className={`mx-auto w-20 ${calculatedCellCls}`}>{fmt(c.taxable)}</div>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <div className={`mx-auto w-20 ${calculatedCellCls}`}>{fmt(c.vat)}</div>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <div className="mx-auto w-20 rounded bg-gray-50 px-1.5 py-1 text-sm text-center font-medium text-gray-900">
                        {fmt(c.total)}
                      </div>
                    </td>
                    <td className="px-1 py-1 text-center">
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

      {dialog}

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
