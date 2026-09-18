"use client";

import { useMemo, useState } from "react";
import { voidInvoice } from "./actions";
import { EditInvoiceModal } from "./edit-invoice-modal";

type Customer = { id: string; name: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type Invoice = {
  id: string;
  invoiceNumber: string;
  customerId: string;
  invoiceDate: string;
  total: string;
  status: string;
};

type SortKey = "customer" | "total";
type SortDir = "asc" | "desc";

export function InvoicesTable({
  invoiceList,
  customerById,
  customers,
  cashBankAccounts,
  customerBalances,
  vatRate,
}: {
  invoiceList: Invoice[];
  customerById: Record<string, Customer>;
  customers: Customer[];
  cashBankAccounts: CashBankGroup[];
  customerBalances: Record<string, number>;
  vatRate: number;
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [editingId, setEditingId] = useState<string | null>(null);

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return invoiceList;
    return [...invoiceList].sort((a, b) => {
      const av = sortKey === "total" ? Number(a.total) : customerById[a.customerId]?.name ?? "";
      const bv = sortKey === "total" ? Number(b.total) : customerById[b.customerId]?.name ?? "";
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [invoiceList, customerById, sortKey, sortDir]);

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  return (
    <>
      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-4 py-2 font-medium">Invoice #</th>
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("customer")}
            >
              Customer{sortIndicator("customer")}
            </th>
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("total")}
            >
              Amount{sortIndicator("total")}
            </th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((inv) => (
            <tr key={inv.id} className="border-t border-gray-100">
              <td className="px-4 py-2">{inv.invoiceDate}</td>
              <td className="px-4 py-2 font-mono">{inv.invoiceNumber}</td>
              <td className="px-4 py-2">{customerById[inv.customerId]?.name ?? "—"}</td>
              <td className="px-4 py-2">
                {Number(inv.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
              <td className="px-4 py-2 capitalize">{inv.status.replace("_", " ")}</td>
              <td className="px-4 py-2 text-right space-x-3 whitespace-nowrap">
                {inv.status !== "void" && (
                  <button type="button" onClick={() => setEditingId(inv.id)} className="text-xs text-gray-600 hover:underline">
                    Edit
                  </button>
                )}
                {inv.status !== "void" && (
                  <form
                    action={voidInvoice}
                    className="inline"
                    onSubmit={(e) => {
                      if (!confirm(`Void invoice ${inv.invoiceNumber}?`)) e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="invoiceId" value={inv.id} />
                    <button type="submit" className="text-red-600 hover:underline text-xs">
                      Void
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                No invoices yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editingId && (
        <EditInvoiceModal
          invoiceId={editingId}
          customers={customers}
          cashBankAccounts={cashBankAccounts}
          customerBalances={customerBalances}
          vatRate={vatRate}
          onClose={() => setEditingId(null)}
        />
      )}
    </>
  );
}
