"use client";

import { useMemo, useState } from "react";
import { voidSalesReturn } from "./actions";

import { D } from "@/components/calendar/date-text";
type Customer = { id: string; name: string };
type Note = {
  id: string;
  noteNumber: string;
  customerId: string;
  noteDate: string;
  total: string;
  status: string;
};

type SortKey = "date" | "noteNumber" | "customer" | "total" | "status";
type SortDir = "asc" | "desc";

export function SalesReturnsTable({
  noteList,
  customerById,
}: {
  noteList: Note[];
  customerById: Record<string, Customer>;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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
      ? noteList
      : noteList.filter(
          (n) =>
            n.noteNumber.toLowerCase().includes(q) ||
            (customerById[n.customerId]?.name ?? "").toLowerCase().includes(q) ||
            n.total.toLowerCase().includes(q)
        );

    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        let av: string | number;
        let bv: string | number;
        switch (sortKey) {
          case "date":
            av = a.noteDate;
            bv = b.noteDate;
            break;
          case "noteNumber":
            av = a.noteNumber;
            bv = b.noteNumber;
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
  }, [noteList, customerById, search, sortKey, sortDir]);

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
          placeholder="Search by customer, debit note #, amount..."
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
              onClick={() => toggleSort("noteNumber")}
            >
              Debit note #{sortIndicator("noteNumber")}
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
          {sorted.map((n) => (
            <tr key={n.id} className="border-t border-gray-100">
              <td className="px-4 py-2"><D value={n.noteDate} /></td>
              <td className="px-4 py-2 font-mono">{n.noteNumber}</td>
              <td className="px-4 py-2">{customerById[n.customerId]?.name ?? "—"}</td>
              <td className="px-4 py-2">
                {Number(n.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
              <td className="px-4 py-2 capitalize">{n.status}</td>
              <td className="px-4 py-2 text-right space-x-3 whitespace-nowrap">
                {n.status !== "void" && (
                  <form
                    action={voidSalesReturn}
                    className="inline"
                    onSubmit={(e) => {
                      if (!confirm(`Void debit note ${n.noteNumber}?`)) e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="noteId" value={n.id} />
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
                No debit notes yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

    </>
  );
}
