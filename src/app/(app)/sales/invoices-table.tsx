"use client";

import { useMemo, useState } from "react";
import { voidInvoice } from "./actions";
import { EditSingleInvoiceModal } from "./edit-single-invoice-modal";

type Customer = { id: string; name: string };
type Item = { id: string; name: string; sellingPrice: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type Invoice = {
  id: string;
  invoiceNumber: string;
  customerId: string;
  invoiceDate: string;
  total: string;
  status: string;
};

type SortKey = "date" | "invoiceNumber" | "customer" | "total" | "status";
type SortDir = "asc" | "desc";

export function InvoicesTable({
  invoiceList,
  customerById,
  customers,
  items,
  cashBankAccounts,
  customerBalances,
  vatRate,
}: {
  invoiceList: Invoice[];
  customerById: Record<string, Customer>;
  customers: Customer[];
  items: Item[];
  cashBankAccounts: CashBankGroup[];
  customerBalances: Record<string, number>;
  vatRate: number;
}) {
  const [search, setSearch] = useState("");
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
    const q = search.trim().toLowerCase();
    let rows = !q
      ? invoiceList
      : invoiceList.filter(
          (inv) =>
            inv.invoiceNumber.toLowerCase().includes(q) ||
            (customerById[inv.customerId]?.name ?? "").toLowerCase().includes(q) ||
            inv.total.toLowerCase().includes(q)
        );

    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        let av: string | number;
        let bv: string | number;
        switch (sortKey) {
          case "date":
            av = a.invoiceDate;
            bv = b.invoiceDate;
            break;
          case "invoiceNumber":
            av = a.invoiceNumber;
            bv = b.invoiceNumber;
            break;
          case "total":
            av = Number(a.total);
            bv = Number(b.total);
            break;
          case "status":
            av = a.status;
            bv = b.status;
            break;
          default:
            av = customerById[a.customerId]?.name ?? "";
            bv = customerById[b.customerId]?.name ?? "";
        }
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return rows;
  }, [invoiceList, customerById, search, sortKey, sortDir]);

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by customer, invoice #, amount..."
          className="rounded border border-gray-300 px-3 py-1.5 text-sm w-72"
        />
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("date")}
            >
              Date{sortIndicator("date")}
            </th>
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("invoiceNumber")}
            >
              Invoice #{sortIndicator("invoiceNumber")}
            </th>
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
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("status")}
            >
              Status{sortIndicator("status")}
            </th>
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
        <EditSingleInvoiceModal
          invoiceId={editingId}
          customers={customers}
          items={items}
          cashBankAccounts={cashBankAccounts}
          customerBalances={customerBalances}
          vatRate={vatRate}
          onClose={() => setEditingId(null)}
        />
      )}
    </>
  );
}
