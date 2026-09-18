"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { recordSalesBatch } from "./actions";
import { PaymentModal } from "./payment-modal";
import { ConfirmDialog } from "./confirm-dialog";
import { buildInvoiceNumber } from "@/lib/invoice-number";

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
const CELL_TEXT = "text-sm";
const DATE_FILL_AHEAD = 5;
const today = () => new Date().toISOString().slice(0, 10);
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

function flattenAccounts(groups: CashBankGroup[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const g of groups) {
    if (g.children.length === 0) map[g.id] = g.name;
    else for (const c of g.children) map[c.id] = c.name;
  }
  return map;
}

export function InvoiceForm({
  customers,
  vatRate,
  cashBankAccounts,
  customerBalances,
  invoiceNumbering,
}: {
  customers: Customer[];
  vatRate: number;
  cashBankAccounts: CashBankGroup[];
  customerBalances: Record<string, number>;
  invoiceNumbering: InvoiceNumbering;
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
  const [confirmAction, setConfirmAction] = useState<"save" | "reset" | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function close() {
      setContextMenu(null);
    }
    window.addEventListener("click", close);
    window.addEventListener("keydown", (e) => e.key === "Escape" && close());
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  const accountLabels = flattenAccounts(cashBankAccounts);

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
    setConfirmAction(null);
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

  function handleSaveClick() {
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
    setConfirmAction("save");
  }

  async function performSave() {
    setConfirmAction(null);
    const validRows = rows.filter(isRowComplete);

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
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const activeRow = paymentRow !== null ? rows[paymentRow] : null;
  const activeRowTotal = activeRow ? computeRow(activeRow, vatRate).total : 0;

  const grandTotal = rows.reduce((s, r) => s + computeRow(r, vatRate).total, 0);
  const paidByAccount = new Map<string, number>();
  for (const r of rows) {
    for (const p of r.payments) {
      paidByAccount.set(p.accountId, (paidByAccount.get(p.accountId) ?? 0) + p.amount);
    }
  }
  const totalPaid = rows.reduce((s, r) => s + paymentTotal(r), 0);
  const totalCredit = Math.max(grandTotal - totalPaid, 0);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-1.5 py-1.5 font-bold text-xs whitespace-nowrap">Invoice no</th>
              <th className="px-1.5 py-1.5 font-bold text-xs whitespace-nowrap">Date</th>
              <th className="px-1.5 py-1.5 font-bold text-xs whitespace-nowrap">Select customer</th>
              <th className="px-1.5 py-1.5 font-bold text-xs whitespace-nowrap">Gross amount</th>
              <th className="px-1.5 py-1.5 font-bold text-xs whitespace-nowrap">Discount</th>
              <th className="px-1 py-2 font-bold text-xs whitespace-nowrap">Taxable</th>
              <th className="px-1 py-2 font-bold text-xs whitespace-nowrap">VAT</th>
              <th className="px-1 py-2 font-bold text-xs whitespace-nowrap">Total</th>
              <th className="px-1.5 py-1.5 font-bold text-xs whitespace-nowrap"></th>
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
                  <td className={`px-1 py-1 text-gray-500 ${CELL_TEXT}`}>{previewNumber}</td>
                  <td className="px-1 py-1">
                    <input
                      type="date"
                      max={today()}
                      value={row.invoiceDate}
                      onChange={(e) => updateRow(i, "invoiceDate", e.target.value)}
                      className={`w-32 rounded border border-gray-300 px-1.5 py-1 ${CELL_TEXT}`}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <select
                      value={row.customerId}
                      onChange={(e) => updateRow(i, "customerId", e.target.value)}
                      className={`w-40 rounded border border-gray-300 px-1.5 py-1 ${CELL_TEXT}`}
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
                      className={`w-24 rounded border border-gray-300 px-1.5 py-1 ${CELL_TEXT}`}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={row.discountAmount}
                      onChange={(e) => updateRow(i, "discountAmount", e.target.value)}
                      className={`w-24 rounded border border-gray-300 px-1.5 py-1 ${CELL_TEXT}`}
                    />
                  </td>
                  <td className={`px-1 py-1 text-gray-600 ${CELL_TEXT}`}>
                    <div className="w-24 overflow-x-auto whitespace-nowrap">{c.taxable.toFixed(2)}</div>
                  </td>
                  <td className={`px-1 py-1 text-gray-600 ${CELL_TEXT}`}>
                    <div className="w-24 overflow-x-auto whitespace-nowrap">{c.vat.toFixed(2)}</div>
                  </td>
                  <td className={`px-1 py-1 font-medium text-gray-900 ${CELL_TEXT}`}>
                    <div className="w-24 overflow-x-auto whitespace-nowrap">{c.total.toFixed(2)}</div>
                  </td>
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => handleRecordPayClick(i)}
                      className="whitespace-nowrap rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs px-3 py-1.5"
                    >
                      {row.payments.length > 0 ? "EDIT PAY" : "RECORD PAY"}
                    </button>
                    {errorRow === i && (
                      <p className={`mt-1 w-40 text-red-600 ${CELL_TEXT}`}>Date and gross amount are required.</p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={handleAddRows} className="text-sm text-gray-600 hover:text-gray-900">
          + Add rows
        </button>
        <input
          type="number"
          min="1"
          max="100"
          value={addCount}
          onChange={(e) => setAddCount(e.target.value)}
          className="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </div>

      <div className="flex flex-wrap justify-center gap-6">
        <div>
          <h3 className="mb-2 text-base font-medium text-gray-700">Sales summary</h3>
          <div className="w-64 rounded-lg border border-gray-300 bg-white p-4">
            <div className="flex items-center justify-between text-sm text-gray-900">
              <span>Grand total sales</span>
              <span className="font-medium">{grandTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-base font-medium text-gray-700">Settlement summary</h3>
          <div className="w-64 rounded-lg border border-gray-300 bg-white p-4 space-y-2">
            {paidByAccount.size === 0 && totalCredit <= 0 && <p className="text-sm text-gray-400">—</p>}
            {[...paidByAccount.entries()].map(([accountId, amount]) => (
              <div key={accountId} className="flex items-center justify-between text-sm text-gray-900">
                <span>{accountLabels[accountId] ?? "Account"}</span>
                <span>{amount.toFixed(2)}</span>
              </div>
            ))}
            {totalCredit > 0 && (
              <div className="flex items-center justify-between text-sm text-gray-900">
                <span>Credit</span>
                <span>{totalCredit.toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-sm">
              <span className="font-medium text-gray-900">Total</span>
              <span className="font-bold text-gray-900">{(totalPaid + totalCredit).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        {saveError && <span className="text-xs text-red-600">{saveError}</span>}
        {savedMessage && <span className="text-xs text-green-600">Saved</span>}
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
          onClick={() => setConfirmAction("reset")}
          disabled={saving}
          className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-4 py-1.5 disabled:opacity-50"
        >
          RESET
        </button>
      </div>

      {confirmAction === "save" && (
        <ConfirmDialog
          message="Do you want to save?"
          onYes={performSave}
          onNo={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === "reset" && (
        <ConfirmDialog
          message="Do you want to reset?"
          onYes={performReset}
          onNo={() => setConfirmAction(null)}
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
