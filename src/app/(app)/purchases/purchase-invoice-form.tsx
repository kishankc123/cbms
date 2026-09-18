"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPurchaseInvoice, updatePurchaseInvoice, type CashBillType } from "./actions";
import { ConfirmDialog } from "../sales/confirm-dialog";
import { InvoicePaymentModal } from "./invoice-payment-modal";

type Vendor = { id: string; name: string };
type Item = { id: string; name: string; unit: string | null; defaultRate: string };
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
const today = () => new Date().toISOString().slice(0, 10);
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

function flattenAccounts(groups: CashBankGroup[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const g of groups) {
    if (g.children.length === 0) map[g.id] = g.name;
    else for (const c of g.children) map[c.id] = c.name;
  }
  return map;
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

export function PurchaseInvoiceForm({
  vendors,
  items,
  cashBankAccounts,
  vatRate,
  initial,
  onDone,
}: {
  vendors: Vendor[];
  items: Item[];
  cashBankAccounts: CashBankGroup[];
  vatRate: number;
  initial?: InitialInvoice;
  onDone?: () => void;
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
  const [savedMessage, setSavedMessage] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);

  useEffect(() => {
    if (!showPayment) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowPayment(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showPayment]);

  const accountLabels = flattenAccounts(cashBankAccounts);

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
            rate: item ? item.defaultRate : l.rate,
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
  const paidTotal = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(grandTotal - paidTotal, 0);

  function handleSaveClick() {
    setSaveError(null);
    if (!invoiceNumber.trim()) {
      setSaveError("Invoice number is required.");
      return;
    }
    if (!vendorId) {
      setSaveError("Select a supplier.");
      return;
    }
    if (!lines.some(isLineComplete)) {
      setSaveError("Add at least one item line with rate and quantity.");
      return;
    }
    setConfirmSave(true);
  }

  async function performSave() {
    setConfirmSave(false);
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
        setSavedMessage(true);
        setTimeout(() => setSavedMessage(false), 2500);
      }
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4 max-w-3xl">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Date</label>
          <input
            type="date"
            max={today()}
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Invoice number</label>
          <input
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Select supplier</label>
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
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-3 py-2 font-bold text-xs whitespace-nowrap">Item</th>
              <th className="px-3 py-2 font-bold text-xs whitespace-nowrap">Rate</th>
              <th className="px-3 py-2 font-bold text-xs whitespace-nowrap">Qty</th>
              <th className="px-1 py-2 font-bold text-xs whitespace-nowrap">Gross</th>
              <th className="px-3 py-2 font-bold text-xs whitespace-nowrap">Discount</th>
              <th className="px-1 py-2 font-bold text-xs whitespace-nowrap">Taxable</th>
              <th className="px-1 py-2 font-bold text-xs whitespace-nowrap">VAT</th>
              <th className="px-1 py-2 font-bold text-xs whitespace-nowrap">Total</th>
              <th className="px-3 py-2 font-bold text-xs whitespace-nowrap"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => {
              const c = computedLines[i];
              return (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-2 py-1">
                    <select
                      value={line.itemId}
                      onChange={(e) => updateLine(i, "itemId", e.target.value)}
                      className="w-32 rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                      <option value="">Custom</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.rate}
                      onChange={(e) => updateLine(i, "rate", e.target.value)}
                      className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.quantity}
                      onChange={(e) => updateLine(i, "quantity", e.target.value)}
                      className="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-1 py-1 text-gray-600 text-sm">
                    <div className="w-20 overflow-x-auto whitespace-nowrap">{c.gross.toFixed(2)}</div>
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.discount}
                      onChange={(e) => updateLine(i, "discount", e.target.value)}
                      className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-1 py-1 text-gray-600 text-sm">
                    <div className="w-20 overflow-x-auto whitespace-nowrap">{c.taxable.toFixed(2)}</div>
                  </td>
                  <td className="px-1 py-1 text-gray-600 text-sm">
                    <div className="w-20 overflow-x-auto whitespace-nowrap">{c.vat.toFixed(2)}</div>
                  </td>
                  <td className="px-1 py-1 font-medium text-gray-900 text-sm">
                    <div className="w-20 overflow-x-auto whitespace-nowrap">{c.total.toFixed(2)}</div>
                  </td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      onClick={() => handleDeleteLine(i)}
                      className="text-xs text-red-600 hover:underline"
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

      <button type="button" onClick={handleAddLine} className="text-sm text-gray-600 hover:text-gray-900">
        + Add line
      </button>

      <div className="flex flex-wrap justify-center gap-6">
        <div>
          <h3 className="mb-2 text-base font-medium text-gray-700">Invoice summary</h3>
          <div className="w-64 rounded-lg border border-gray-300 bg-white p-4 space-y-1 text-sm text-gray-900">
            <div className="flex items-center justify-between">
              <span>Gross</span>
              <span>{grandGross.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Taxable</span>
              <span>{grandTaxable.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>VAT</span>
              <span>{grandVat.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 pt-1 font-medium">
              <span>Total</span>
              <span>{grandTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-base font-medium text-gray-700">Settlement summary</h3>
          <div className="w-64 rounded-lg border border-gray-300 bg-white p-4 space-y-2">
            {payments.length === 0 && remaining <= 0 && <p className="text-sm text-gray-400">—</p>}
            {payments.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-sm text-gray-900">
                <span>{accountLabels[p.accountId] ?? "Account"}</span>
                <span>{p.amount.toFixed(2)}</span>
              </div>
            ))}
            {remaining > 0 && (
              <div className="flex items-center justify-between text-sm text-gray-900">
                <span>Accounts Payable (credit)</span>
                <span>{remaining.toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-sm">
              <span className="font-medium text-gray-900">Total</span>
              <span className="font-bold text-gray-900">{grandTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        {saveError && <span className="text-xs text-red-600">{saveError}</span>}
        {savedMessage && <span className="text-xs text-green-600">Saved</span>}
        <button
          type="button"
          onClick={() => setShowPayment(true)}
          className="whitespace-nowrap rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
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
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            disabled={saving}
            className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-4 py-1.5 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>

      {confirmSave && (
        <ConfirmDialog message="Do you want to save?" onYes={performSave} onNo={() => setConfirmSave(false)} />
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
