"use client";

import { useMemo, useState } from "react";
import { voidExpense, getExpenseForEdit, type ExpenseEditData } from "./actions";
import { ExpenseFormModal, type InitialExpense } from "./expense-form-modal";
import { RecordExpensePaymentModal } from "./record-expense-payment-modal";

import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
import { D } from "@/components/calendar/date-text";
import { DateDisplayControl, useDateDisplay } from "@/components/calendar/report-dates";
import { exportDateColumns, exportDateHeaders, type DateDisplayMode } from "@/lib/calendar";
type Vendor = { id: string; name: string };
type CategoryAccount = { id: string; code: string; name: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };

type ExpenseRow = {
  id: string;
  expenseNumber: string;
  expenseDate: string;
  payee: string;
  vendorId: string | null;
  category: string;
  categoryAccountId: string;
  description: string;
  subtotal: number;
  tax: number;
  total: number;
  amountPayable: number;
  amountPaid: number;
  status: string;
  dueDate: string | null;
};

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "unpaid", label: "Unpaid" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
];

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

export function ExpensesTable({
  expenses,
  vendors,
  categoryAccounts,
  cashBankAccounts,
  vatRate,
  tdsRate,
}: {
  expenses: ExpenseRow[];
  vendors: Vendor[];
  categoryAccounts: CategoryAccount[];
  cashBankAccounts: CashBankGroup[];
  vatRate: number;
  tdsRate: number;
}) {
  const [exportDates, setExportDates] = useDateDisplay();
  const [showNewForm, setShowNewForm] = useState(false);
  const [editData, setEditData] = useState<InitialExpense | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [payingRow, setPayingRow] = useState<ExpenseRow | null>(null);
  const [viewingRow, setViewingRow] = useState<ExpenseRow | null>(null);

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const today = useMemo(() => todayIso(), []);

  const summary = useMemo(() => {
    const active = expenses.filter((e) => e.status !== "void");
    const total = active.reduce((s, e) => s + e.total, 0);
    const paid = active.filter((e) => e.status === "paid").reduce((s, e) => s + e.total, 0);
    const outstanding = active.filter((e) => e.status !== "paid");
    const unpaid = outstanding.reduce((s, e) => s + (e.amountPayable - e.amountPaid), 0);
    const overdue = outstanding
      .filter((e) => e.dueDate && e.dueDate < today)
      .reduce((s, e) => s + (e.amountPayable - e.amountPaid), 0);
    return { total, paid, unpaid, overdue };
  }, [expenses, today]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenses.filter((e) => {
      if (q && !e.payee.toLowerCase().includes(q) && !e.expenseNumber.toLowerCase().includes(q)) return false;
      if (dateFrom && e.expenseDate < dateFrom) return false;
      if (dateTo && e.expenseDate > dateTo) return false;
      if (categoryFilter && e.categoryAccountId !== categoryFilter) return false;
      if (statusFilter && e.status !== statusFilter) return false;
      return true;
    });
  }, [expenses, search, dateFrom, dateTo, categoryFilter, statusFilter]);

  async function openEdit(id: string) {
    setEditError(null);
    try {
      const data = await getExpenseForEdit(id);
      setEditData(toInitial(data));
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Failed to load expense");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-end gap-2">
        <button
          type="button"
          onClick={() => setShowNewForm(true)}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
        >
          + New Expense
        </button>
        <DateDisplayControl label="Export dates" value={exportDates} onChange={setExportDates} />
        <button
          type="button"
          disabled
          title="Coming soon"
          className="rounded border border-gray-300 text-gray-400 text-sm px-4 py-1.5 cursor-not-allowed"
        >
          Import
        </button>
        <button
          type="button"
          onClick={() => exportCsv(filtered, exportDates)}
          className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-4 py-1.5"
        >
          Export
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <SummaryCard label="Total Expenses" value={fmt(summary.total)} />
        <SummaryCard label="Unpaid Expenses" value={fmt(summary.unpaid)} />
        <SummaryCard label="Paid Expenses" value={fmt(summary.paid)} />
        <SummaryCard label="Overdue Expenses" value={fmt(summary.overdue)} />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by supplier, expense #..."
          className="rounded border border-gray-300 px-3 py-1.5 text-sm w-56"
        />
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <DatePicker value={dateFrom} onChange={(v) => setDateFrom(v)} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <DatePicker value={dateTo} onChange={(v) => setDateTo(v)} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">All categories</option>
          {categoryAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {editError && <p className="text-sm text-red-600">{editError}</p>}

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Expense #</th>
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-4 py-2 font-medium">Supplier</th>
            <th className="px-4 py-2 font-medium">Category</th>
            <th className="px-4 py-2 font-medium">Description</th>
            <th className="px-4 py-2 font-medium">Net amount</th>
            <th className="px-4 py-2 font-medium">Tax</th>
            <th className="px-4 py-2 font-medium">Total</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((e) => (
            <tr key={e.id} className="border-t border-gray-100">
              <td className="px-4 py-2 font-mono">{e.expenseNumber}</td>
              <td className="px-4 py-2"><D value={e.expenseDate} /></td>
              <td className="px-4 py-2">{e.payee}</td>
              <td className="px-4 py-2">{e.category}</td>
              <td className="px-4 py-2 max-w-[200px] truncate">{e.description || "—"}</td>
              <td className="px-4 py-2">{fmt(e.subtotal)}</td>
              <td className="px-4 py-2">{fmt(e.tax)}</td>
              <td className="px-4 py-2">{fmt(e.total)}</td>
              <td className={`px-4 py-2 capitalize ${(e.status === "unpaid" || e.status === "partially_paid") && e.dueDate && e.dueDate < today ? "font-medium text-red-600" : ""}`}>{((e.status === "unpaid" || e.status === "partially_paid") && e.dueDate && e.dueDate < today ? "overdue" : e.status).replace("_", " ")}</td>
              <td className="px-4 py-2 text-right space-x-2 whitespace-nowrap">
                <button type="button" onClick={() => setViewingRow(e)} className="text-xs text-gray-600 hover:underline">
                  View
                </button>
                {e.status !== "void" && e.amountPaid === 0 && (
                  <button type="button" onClick={() => openEdit(e.id)} className="text-xs text-gray-600 hover:underline">
                    Edit
                  </button>
                )}
                {(e.status === "unpaid" || e.status === "partially_paid") && (
                  <button type="button" onClick={() => setPayingRow(e)} className="text-xs text-[var(--color-primary)] hover:underline">
                    Record Payment
                  </button>
                )}
                {e.status !== "void" && (
                  <form
                    action={voidExpense}
                    className="inline"
                    onSubmit={(ev) => {
                      if (!confirm(`Void expense ${e.expenseNumber}?`)) ev.preventDefault();
                    }}
                  >
                    <input type="hidden" name="expenseId" value={e.id} />
                    <button type="submit" className="text-xs text-red-600 hover:underline">
                      Void
                    </button>
                  </form>
                )}
                <button type="button" onClick={() => window.print()} className="text-xs text-gray-600 hover:underline">
                  Print
                </button>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={10} className="px-4 py-6 text-center text-gray-400">
                No expenses match
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {showNewForm && (
        <ExpenseFormModal
          vendors={vendors}
          categoryAccounts={categoryAccounts}
          cashBankAccounts={cashBankAccounts}
          vatRate={vatRate}
          tdsRate={tdsRate}
          onClose={() => setShowNewForm(false)}
        />
      )}

      {editData && (
        <ExpenseFormModal
          vendors={vendors}
          categoryAccounts={categoryAccounts}
          cashBankAccounts={cashBankAccounts}
          vatRate={vatRate}
          tdsRate={tdsRate}
          initial={editData}
          onClose={() => setEditData(null)}
        />
      )}

      {payingRow && (
        <RecordExpensePaymentModal
          expenseId={payingRow.id}
          expenseNumber={payingRow.expenseNumber}
          remaining={payingRow.amountPayable - payingRow.amountPaid}
          cashBankAccounts={cashBankAccounts}
          onClose={() => setPayingRow(null)}
        />
      )}

      {viewingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setViewingRow(null)} />
          <div className="relative w-full max-w-md rounded-lg bg-white p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">{viewingRow.expenseNumber}</h2>
              <button type="button" onClick={() => setViewingRow(null)} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-gray-500">Date</p>
                <p className="text-gray-900"><D value={viewingRow.expenseDate} /></p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Supplier</p>
                <p className="text-gray-900">{viewingRow.payee}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Category</p>
                <p className="text-gray-900">{viewingRow.category}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Status</p>
                <p className="text-gray-900 capitalize">{viewingRow.status.replace("_", " ")}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-gray-500">Description</p>
                <p className="text-gray-900">{viewingRow.description || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Net amount</p>
                <p className="text-gray-900">{fmt(viewingRow.subtotal)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Tax</p>
                <p className="text-gray-900">{fmt(viewingRow.tax)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Total</p>
                <p className="text-gray-900">{fmt(viewingRow.total)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Amount paid</p>
                <p className="text-gray-900">{fmt(viewingRow.amountPaid)}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => window.print()} className="text-sm text-gray-600 hover:underline">
                Print
              </button>
              <button
                type="button"
                onClick={() => setViewingRow(null)}
                className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function toInitial(data: ExpenseEditData): InitialExpense {
  return { ...data };
}

function exportCsv(rows: ExpenseRow[], dateMode: DateDisplayMode) {
  const header = ["Expense #", ...exportDateHeaders(dateMode), "Supplier", "Category", "Description", "Net amount", "Tax", "Total", "Status"];
  const lines = rows.map((e) =>
    [e.expenseNumber, ...exportDateColumns(dateMode, e.expenseDate), e.payee, e.category, e.description, e.subtotal, e.tax, e.total, e.status]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "expenses.csv";
  a.click();
  URL.revokeObjectURL(url);
}
