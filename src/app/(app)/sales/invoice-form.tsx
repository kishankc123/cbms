"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { recordSalesBatch } from "./actions";
import { PaymentModal } from "./payment-modal";
import { ConfirmDialog } from "./confirm-dialog";
import { buildInvoiceNumber } from "@/lib/invoice-number";

import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
type Customer = { id: string; name: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type InvoiceNumbering = { prefix: string; suffix: string; format: string; nextSequence: number };
type PaymentLine = { accountId: string; amount: number };

type Row = {
  invoiceDate: string;
  customerId: string;
  grossAmount: string;
  discountAmount: string;
  payments: PaymentLine[];
};

const MIN_ROWS = 7;
const DATE_FILL_AHEAD = 5;
const fmt = (n: number) => n.toFixed(2);
const today = () => todayIso();
const emptyRow = (): Row => ({ invoiceDate: "", customerId: "", grossAmount: "", discountAmount: "0", payments: [] });

function computeRow(row: Row, vatRate: number) {
  const gross = parseFloat(row.grossAmount) || 0;
  const discount = parseFloat(row.discountAmount) || 0;
  const taxable = Math.max(gross - discount, 0);
  const vat = taxable * (vatRate / 100);
  const total = taxable + vat;
  return { gross, discount, taxable, vat, total };
}

function paymentTotal(row: Row) {
  return row.payments.reduce((s, p) => s + p.amount, 0);
}

// Deliberately excludes invoiceDate: picking a date auto-fills the next few
// rows (see DATE_FILL_AHEAD), and a row that only received that auto-filled
// date — nothing else — shouldn't count as "touched" and block saving.
function isRowTouched(row: Row) {
  return Boolean(row.customerId || (parseFloat(row.grossAmount) || 0) > 0);
}

function isRowComplete(row: Row) {
  return Boolean(row.invoiceDate && (parseFloat(row.grossAmount) || 0) > 0);
}

const cellInputCls =
  "rounded border border-gray-300 bg-white px-1.5 py-1 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";
const calculatedCellCls = "rounded bg-gray-50 px-1.5 py-1 text-sm text-right text-gray-600";

export function InvoiceForm({
  customers,
  vatRate,
  cashBankAccounts,
  customerBalances,
  invoiceNumbering,
  onDirtyChange,
}: {
  customers: Customer[];
  vatRate: number;
  cashBankAccounts: CashBankGroup[];
  customerBalances: Record<string, number>;
  invoiceNumbering: InvoiceNumbering;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: MIN_ROWS }, emptyRow));
  const [addCount, setAddCount] = useState("1");
  const [errorRow, setErrorRow] = useState<number | null>(null);
  const [paymentRow, setPaymentRow] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ rowIndex: number; x: number; y: number } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!contextMenu) return;
    function close() {
      setContextMenu(null);
    }
    window.addEventListener("click", close);
    window.addEventListener("keydown", (e) => e.key === "Escape" && close());
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  useEffect(() => {
    onDirtyChange?.(rows.some(isRowTouched));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  function updateRow(i: number, field: "invoiceDate" | "customerId" | "grossAmount" | "discountAmount", value: string) {
    setRows((prev) => {
      const next = prev.map((row, idx) => (idx === i ? { ...row, [field]: value } : row));
      if (field === "invoiceDate" && value) {
        for (let j = i + 1; j <= i + DATE_FILL_AHEAD && j < next.length; j++) {
          if (!next[j].invoiceDate) next[j] = { ...next[j], invoiceDate: value };
        }
      }
      return next;
    });
  }

  function handleDeleteRow(i: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
    setContextMenu(null);
  }

  function handleAddRows() {
    const n = Math.max(1, Math.min(100, parseInt(addCount, 10) || 1));
    setRows((prev) => [...prev, ...Array.from({ length: n }, emptyRow)]);
  }

  function performReset() {
    setRows(Array.from({ length: MIN_ROWS }, emptyRow));
    setSaveError(null);
    setConfirmReset(false);
  }

  function handleRecordPayClick(i: number) {
    setErrorRow(isRowComplete(rows[i]) ? null : i);
    if (!isRowComplete(rows[i])) return;
    setPaymentRow(i);
  }

  function handleConfirmPayment(payments: { accountId: string; amount: number }[], customerId: string) {
    if (paymentRow === null) return;
    setRows((prev) =>
      prev.map((r, idx) => (idx === paymentRow ? { ...r, payments, customerId: customerId || r.customerId } : r))
    );
    setPaymentRow(null);
  }

  async function performSave() {
    setSaveError(null);
    const hasIncompleteRow = rows.some((r) => isRowTouched(r) && !isRowComplete(r));
    if (hasIncompleteRow) {
      setSaveError("Some rows are missing a date or gross amount — finish or clear them before saving.");
      return;
    }
    const validRows = rows.filter(isRowComplete);
    if (validRows.length === 0) {
      setSaveError("Add at least one invoice row before saving.");
      return;
    }

    setSaving(true);
    try {
      await recordSalesBatch({
        rows: validRows.map((r) => ({
          invoiceDate: r.invoiceDate,
          customerId: r.customerId,
          grossAmount: parseFloat(r.grossAmount) || 0,
          discountAmount: parseFloat(r.discountAmount) || 0,
          payments: r.payments,
        })),
      });
      setRows(Array.from({ length: MIN_ROWS }, emptyRow));
      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 2500);
      onDirtyChange?.(false);
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const activeRow = paymentRow !== null ? rows[paymentRow] : null;
  const activeRowTotal = activeRow ? computeRow(activeRow, vatRate).total : 0;

  const completeRows = rows.filter(isRowComplete);
  const computedRows = completeRows.map((r) => computeRow(r, vatRate));
  const totalInvoices = completeRows.length;
  const grossSales = computedRows.reduce((s, c) => s + c.gross, 0);
  const totalDiscount = computedRows.reduce((s, c) => s + c.discount, 0);
  const taxableSales = computedRows.reduce((s, c) => s + c.taxable, 0);
  const totalVat = computedRows.reduce((s, c) => s + c.vat, 0);
  const grandTotal = computedRows.reduce((s, c) => s + c.total, 0);
  const totalPaid = completeRows.reduce((s, r) => s + paymentTotal(r), 0);
  const totalOutstanding = Math.max(grandTotal - totalPaid, 0);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Sales Entries</h2>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-1.5 py-1.5 font-semibold text-xs whitespace-nowrap">Invoice No.</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs whitespace-nowrap">Date</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs whitespace-nowrap">Customer</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-right whitespace-nowrap">Gross Amount</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-right whitespace-nowrap">Discount</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-right whitespace-nowrap">Taxable</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-right whitespace-nowrap">VAT</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs text-right whitespace-nowrap">Total</th>
                <th className="px-1.5 py-1.5 font-semibold text-xs whitespace-nowrap">Payment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const c = computeRow(row, vatRate);
                const showPreviewNumber = Boolean(row.invoiceDate || row.customerId);
                const previewNumber = showPreviewNumber
                  ? buildInvoiceNumber(
                      invoiceNumbering.prefix,
                      invoiceNumbering.suffix,
                      invoiceNumbering.nextSequence + i,
                      invoiceNumbering.format
                    )
                  : "";
                return (
                  <tr
                    key={i}
                    className="border-t border-gray-100"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ rowIndex: i, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <td className="px-1 py-1 text-gray-500 text-sm whitespace-nowrap">{previewNumber}</td>
                    <td className="px-1 py-1">
                      <DatePicker max={today()} value={row.invoiceDate} onChange={(v) => updateRow(i, "invoiceDate", v)} className={`w-32 ${cellInputCls}`} />
                    </td>
                    <td className="px-1 py-1">
                      <select
                        value={row.customerId}
                        onChange={(e) => updateRow(i, "customerId", e.target.value)}
                        className={`w-40 ${cellInputCls}`}
                      >
                        <option value="" className="text-gray-400">
                          Select customer
                        </option>
                        {customers.map((cu) => (
                          <option key={cu.id} value={cu.id}>
                            {cu.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.grossAmount}
                        onChange={(e) => updateRow(i, "grossAmount", e.target.value)}
                        className={`w-24 text-right ${cellInputCls}`}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.discountAmount}
                        onChange={(e) => updateRow(i, "discountAmount", e.target.value)}
                        className={`w-24 text-right ${cellInputCls}`}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <div className={`w-24 ${calculatedCellCls}`}>{fmt(c.taxable)}</div>
                    </td>
                    <td className="px-1 py-1">
                      <div className={`w-24 ${calculatedCellCls}`}>{fmt(c.vat)}</div>
                    </td>
                    <td className="px-1 py-1">
                      <div className="w-24 rounded bg-gray-50 px-1.5 py-1 text-sm text-right font-medium text-gray-900">
                        {fmt(c.total)}
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <button
                        type="button"
                        onClick={() => handleRecordPayClick(i)}
                        className="whitespace-nowrap rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs px-2.5 py-1"
                      >
                        {row.payments.length > 0 ? "Edit Payment" : "Record Payment"}
                      </button>
                      {errorRow === i && (
                        <p className="mt-1 w-40 text-xs text-red-600">Date and gross amount are required.</p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm text-gray-500">Rows:</span>
          <input
            type="number"
            min="1"
            max="100"
            value={addCount}
            onChange={(e) => setAddCount(e.target.value)}
            className="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <button type="button" onClick={handleAddRows} className="text-sm text-gray-600 hover:text-gray-900">
            + Add Rows
          </button>
        </div>
      </section>

      <div className="flex flex-wrap gap-4">
        <section className="w-72 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Sales Summary</h2>
          <div className="space-y-1 text-sm text-gray-900">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Total Invoices</span>
              <span>{totalInvoices}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Gross Sales</span>
              <span>{fmt(grossSales)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Discount</span>
              <span>{fmt(totalDiscount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Taxable Sales</span>
              <span>{fmt(taxableSales)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">VAT</span>
              <span>{fmt(totalVat)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 pt-1.5 mt-1.5">
              <span className="font-semibold text-gray-900">Grand Total</span>
              <span className="text-base font-bold text-gray-900">{fmt(grandTotal)}</span>
            </div>
          </div>
        </section>

        <section className="w-72 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Settlement Summary</h2>
          <div className="space-y-1 text-sm text-gray-900">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Paid</span>
              <span>{fmt(totalPaid)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 pt-1.5 mt-1.5">
              <span className="font-semibold text-gray-900">Outstanding</span>
              <span className="text-base font-bold text-gray-900">{fmt(totalOutstanding)}</span>
            </div>
          </div>
        </section>
      </div>

      <div className="flex items-center justify-end gap-3">
        {saveError && <span className="text-xs text-red-600">{saveError}</span>}
        {savedMessage && <span className="text-xs text-green-600">Saved</span>}
        <button
          type="button"
          onClick={performSave}
          disabled={saving}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium px-5 py-1.5 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          disabled={saving}
          className="rounded text-gray-500 hover:text-gray-700 text-sm px-2 py-1.5 disabled:opacity-50"
        >
          Reset
        </button>
      </div>

      {confirmReset && (
        <ConfirmDialog
          message="This will clear all entered rows. Continue?"
          onYes={performReset}
          onNo={() => setConfirmReset(false)}
        />
      )}

      {contextMenu && (
        <div
          className="fixed z-50 rounded border border-gray-200 bg-white py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() => handleDeleteRow(contextMenu.rowIndex)}
            className="block w-full whitespace-nowrap px-4 py-1.5 text-left text-sm text-red-600 hover:bg-gray-50"
          >
            Delete this row
          </button>
        </div>
      )}

      {paymentRow !== null && activeRow && (
        <PaymentModal
          grandTotal={activeRowTotal}
          cashBankAccounts={cashBankAccounts}
          allCustomers={customers}
          customerBalances={customerBalances}
          initialCustomerId={activeRow.customerId}
          initialLines={activeRow.payments}
          saving={false}
          onCancel={() => setPaymentRow(null)}
          onConfirm={handleConfirmPayment}
        />
      )}
    </div>
  );
}
